// WebGL Scatter Plot Renderer
// Zone D: Uses SharedArrayBuffers as Vertex Buffer Objects

import { useEffect, useRef, useState, useCallback } from 'react';

interface ScatterPlotProps {
  width: number;
  height: number;
  pointsCount: number;
  coordsBuffer: ArrayBuffer | SharedArrayBuffer | null;
  selectionBuffer: ArrayBuffer | SharedArrayBuffer | null;
  points?: any[];
  onLassoComplete?: (points: Float32Array) => void;
}

export function ScatterPlot({
  width,
  height,
  pointsCount,
  coordsBuffer,
  selectionBuffer,
  points,
  onLassoComplete
}: ScatterPlotProps) {
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const lassoCanvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const requestRef = useRef<number | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const lassoPoints = useRef<number[]>([]);
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number, y: number, label: string } | null>(null);
  const [contextReady, setContextReady] = useState(false);

  // Initialize WebGL Shaders
  useEffect(() => {
    const canvas = glCanvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', { antialias: true, alpha: true });
    if (!gl) return;

    glRef.current = gl;

    const program = initializeShaders(gl);
    if (program) {
      programRef.current = program;
    }
    setContextReady(true);
  }, []);

  // Handle resolution, sizing and viewport calibration
  useEffect(() => {
    if (!contextReady) return;

    const glCanvas = glCanvasRef.current;
    const lassoCanvas = lassoCanvasRef.current;
    const gl = glRef.current;
    if (!glCanvas || !lassoCanvas || !gl) return;

    const dpr = window.devicePixelRatio || 1;

    // THE SOURCE OF TRUTH: Actual element size in logical pixels
    const rect = glCanvas.getBoundingClientRect();
    const w = rect.width || width || 1;
    const h = rect.height || height || 1;

    // Set internal buffer resolutions (High-DPI)
    // We prioritize the element size over props to ensure perfection
    glCanvas.width = w * dpr;
    glCanvas.height = h * dpr;
    lassoCanvas.width = w * dpr;
    lassoCanvas.height = h * dpr;

    // Calibration: Match viewport to physical pixels
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);

    drawUI();
  }, [contextReady, width, height]);

  // Update WebGL data and start render loop
  useEffect(() => {
    if (!glRef.current || !coordsBuffer || !selectionBuffer || !programRef.current || pointsCount === 0) {
      return;
    }

    const gl = glRef.current;
    const program = programRef.current;

    gl.useProgram(program);

    // Dynamic Position buffer setup
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(coordsBuffer), gl.STATIC_DRAW);

    const aPosition = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    // Dynamic Selection buffer setup
    const selBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, selBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(selectionBuffer), gl.DYNAMIC_DRAW);

    const aSelected = gl.getAttribLocation(program, 'a_selected');
    gl.enableVertexAttribArray(aSelected);
    gl.vertexAttribPointer(aSelected, 1, gl.FLOAT, false, 0, 0);

    const render = () => {
      // Background matches UI palette
      gl.clearColor(0.02, 0.02, 0.05, 0.0); // Transparent to show parent bg
      gl.clear(gl.COLOR_BUFFER_BIT);

      // Sync selection mask in real-time
      gl.bindBuffer(gl.ARRAY_BUFFER, selBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(selectionBuffer), gl.DYNAMIC_DRAW);

      gl.drawArrays(gl.POINTS, 0, pointsCount);
      requestRef.current = requestAnimationFrame(render);
    };

    requestRef.current = requestAnimationFrame(render);

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      gl.deleteBuffer(posBuffer);
      gl.deleteBuffer(selBuffer);
    };
  }, [pointsCount, coordsBuffer, selectionBuffer]);

  // Handle interaction events
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = lassoCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    setIsDrawing(true);
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    lassoPoints.current = [x, y];
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = lassoCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (isDrawing) {
      lassoPoints.current.push(x, y);
      drawUI();
    } else if (points && coordsBuffer) {
      // Hover detection mapping
      const renWidth = rect.width || 1;
      const renHeight = rect.height || 1;

      // Direct Stretch mapping (Direct-Fill mode)
      const mouseX = (x / renWidth) * 2 - 1;
      const mouseY = 1 - (y / renHeight) * 2;

      const coords = new Float32Array(coordsBuffer);
      let closestIdx = -1;
      let minDocs = 0.08;

      for (let i = 0; i < pointsCount; i++) {
        const dx = coords[i * 2] - mouseX;
        const dy = coords[i * 2 + 1] - mouseY;
        const distSq = dx * dx + dy * dy;

        if (distSq < minDocs * minDocs) {
          minDocs = Math.sqrt(distSq);
          closestIdx = i;
        }
      }

      if (closestIdx !== -1 && points[closestIdx]) {
        setHoveredPoint({ x, y, label: points[closestIdx].label });
      } else {
        setHoveredPoint(null);
      }
    }
  };

  const handleMouseUp = () => {
    if (isDrawing && lassoPoints.current.length > 2) {
      setIsDrawing(false);
      const rect = lassoCanvasRef.current?.getBoundingClientRect();
      if (rect) {
        const renWidth = rect.width || 1;
        const renHeight = rect.height || 1;

        const normalizedPoints = new Float32Array(lassoPoints.current.length);
        for (let i = 0; i < lassoPoints.current.length; i += 2) {
          normalizedPoints[i] = (lassoPoints.current[i] / renWidth) * 2 - 1;
          normalizedPoints[i + 1] = 1 - (lassoPoints.current[i + 1] / renHeight) * 2;
        }
        onLassoComplete?.(normalizedPoints);
      }
    }

    setIsDrawing(false);
    lassoPoints.current = [];
    drawUI();
  };

  const drawUI = useCallback(() => {
    const canvas = lassoCanvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    // Reset and clear with scaling
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    // Axis Lines Calibration
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;

    const midX = w / 2;
    const midY = h / 2;

    // X-Axis
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    // Y-Axis
    ctx.beginPath();
    ctx.moveTo(midX, 0);
    ctx.lineTo(midX, h);
    ctx.stroke();

    // Labels Calibration
    ctx.setLineDash([]);
    ctx.font = 'bold 11px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';

    ctx.textAlign = 'right';
    ctx.fillText('PC1 (Variance) \u2192', w - 20, midY - 12);

    ctx.save();
    ctx.translate(midX + 12, 30);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'right';
    ctx.fillText('\u2190 PC2 (Variance)', 0, 0);
    ctx.restore();

    // Lasso Calibration
    if (isDrawing && lassoPoints.current.length >= 2) {
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(lassoPoints.current[0], lassoPoints.current[1]);

      for (let i = 2; i < lassoPoints.current.length; i += 2) {
        ctx.lineTo(lassoPoints.current[i], lassoPoints.current[i + 1]);
      }
      ctx.stroke();
    }
  }, [isDrawing]);

  // Initial draw
  useEffect(() => {
    drawUI();
  }, [drawUI, width, height]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-black/20 rounded-xl overflow-hidden shadow-inner">
      <canvas ref={glCanvasRef} className="absolute inset-0 z-0 w-full h-full" />
      <canvas
        ref={lassoCanvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="absolute inset-0 z-10 cursor-crosshair w-full h-full"
      />

      {hoveredPoint && (
        <div
          className="absolute z-30 bg-black/80 backdrop-blur-md border border-white/20 text-white px-2 py-1 text-[10px] rounded pointer-events-none whitespace-nowrap shadow-xl"
          style={{
            left: hoveredPoint.x + 10,
            top: hoveredPoint.y - 30,
            transform: 'translateX(-50%)'
          }}
        >
          {hoveredPoint.label}
        </div>
      )}

      {isDrawing && (
        <div className="absolute top-4 left-4 z-20 bg-black/60 backdrop-blur-md border border-white/10 text-white px-3 py-1.5 text-xs font-medium rounded-full flex items-center gap-2 shadow-lg">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          Drawing region selection...
        </div>
      )}
    </div>
  );
}

function initializeShaders(gl: WebGLRenderingContext): WebGLProgram | null {
  const vertexShaderSource = `
    attribute vec2 a_position;
    attribute float a_selected;
    
    varying float v_selected;
    
    void main() {
      // Direct mapping to fill the available space (No aspect-ratio clumping)
      gl_Position = vec4(a_position, 0.0, 1.0);
      gl_PointSize = 18.0; 
      v_selected = a_selected;
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;
    varying float v_selected;
    
    void main() {
      float dist = distance(gl_PointCoord, vec2(0.5, 0.5));
      if (dist > 0.5) {
        discard;
      }
      
      float alpha = 1.0 - smoothstep(0.40, 0.5, dist);
      
      if (v_selected > 0.5) {
        gl_FragColor = vec4(1.0, 0.3, 0.3, alpha); 
      } else {
        gl_FragColor = vec4(0.0, 0.8, 1.0, alpha);
      }
    }
  `;

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

  if (!vertexShader || !fragmentShader) return null;

  const program = createProgram(gl, vertexShader, fragmentShader);
  if (!program) return null;

  gl.useProgram(program);
  return program;
}

function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext, vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}
