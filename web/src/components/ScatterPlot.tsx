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

  // Initialize WebGL Shaders
  useEffect(() => {
    const canvas = glCanvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', { antialias: true, alpha: true });
    if (!gl) {
      console.error('WebGL not supported');
      return;
    }

    glRef.current = gl;

    const program = initializeShaders(gl);
    if (program) {
      programRef.current = program;
    }
  }, []);

  // Handle resolution and sizing
  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    const glCanvas = glCanvasRef.current;
    const lassoCanvas = lassoCanvasRef.current;
    if (!glCanvas || !lassoCanvas) return;

    // Set internal buffer sizes
    const pixelWidth = width * dpr;
    const pixelHeight = height * dpr;

    glCanvas.width = pixelWidth;
    glCanvas.height = pixelHeight;
    lassoCanvas.width = pixelWidth;
    lassoCanvas.height = pixelHeight;

    // Set CSS sizes
    glCanvas.style.width = `${width}px`;
    glCanvas.style.height = `${height}px`;
    lassoCanvas.style.width = `${width}px`;
    lassoCanvas.style.height = `${height}px`;

    if (glRef.current) {
      glRef.current.viewport(0, 0, pixelWidth, pixelHeight);

      if (programRef.current) {
        const gl = glRef.current;
        gl.useProgram(programRef.current);
        const uAspect = gl.getUniformLocation(programRef.current, 'u_aspect');
        gl.uniform1f(uAspect, width / height);
      }
    }

    drawUI();
  }, [width, height]);

  // Update WebGL data and start render loop
  useEffect(() => {
    if (!glRef.current || !coordsBuffer || !selectionBuffer || !programRef.current || pointsCount === 0) {
      return;
    }

    const gl = glRef.current;
    const program = programRef.current;

    gl.useProgram(program);

    // Initial u_aspect set
    const uAspect = gl.getUniformLocation(program, 'u_aspect');
    gl.uniform1f(uAspect, width / height || 1.0);

    // Position buffer
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(coordsBuffer), gl.STATIC_DRAW);

    const aPosition = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    // Selection buffer
    const selBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, selBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(selectionBuffer), gl.DYNAMIC_DRAW);

    const aSelected = gl.getAttribLocation(program, 'a_selected');
    gl.enableVertexAttribArray(aSelected);
    gl.vertexAttribPointer(aSelected, 1, gl.FLOAT, false, 0, 0);

    const render = () => {
      gl.clearColor(0.02, 0.02, 0.05, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

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
  }, [width, height, pointsCount, coordsBuffer, selectionBuffer]);

  // Handle lasso drawing
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    lassoPoints.current = [];

    const rect = lassoCanvasRef.current?.getBoundingClientRect();
    if (rect) {
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      lassoPoints.current.push(x, y);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = lassoCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (isDrawing) {
      lassoPoints.current.push(x, y);
      drawLasso();
    } else if (points && coordsBuffer) {
      // Hover detection
      const mouseX = (x / width) * 2 - 1;
      const mouseY = 1 - (y / height) * 2;

      const coords = new Float32Array(coordsBuffer);
      let closestIdx = -1;
      let minDocs = 0.08; // Higher threshold for easier selection

      for (let i = 0; i < pointsCount; i++) {
        const dx = coords[i * 2] - mouseX;
        const dy = coords[i * 2 + 1] - mouseY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < minDocs) {
          minDocs = dist;
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

      // Convert CSS pixels to pure NDC (-1 to 1)
      const normalizedPoints = new Float32Array(lassoPoints.current.length);
      for (let i = 0; i < lassoPoints.current.length; i += 2) {
        normalizedPoints[i] = (lassoPoints.current[i] / width) * 2 - 1;
        normalizedPoints[i + 1] = 1 - (lassoPoints.current[i + 1] / height) * 2;
      }

      onLassoComplete?.(normalizedPoints);
    }

    setIsDrawing(false);
    lassoPoints.current = [];
    drawUI();
  };

  const drawUI = useCallback(() => {
    const dpr = window.devicePixelRatio || 1;
    const canvas = lassoCanvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Reset transform to identity and clear the ACTUAL pixel buffer
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply scaling for Retina
    ctx.scale(dpr, dpr);

    // 1. Draw Axis Lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;

    // CENTER OF THE DRAWING AREA
    const midX = width / 2;
    const midY = height / 2;

    // X-Axis
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    // Y-Axis
    ctx.beginPath();
    ctx.moveTo(midX, 0);
    ctx.lineTo(midX, height);
    ctx.stroke();

    // 2. Draw Labels
    ctx.setLineDash([]);
    ctx.font = 'bold 11px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';

    // PC1 Label
    ctx.textAlign = 'right';
    ctx.fillText('PC1 (Variance) →', width - 20, midY - 12);

    // PC2 Label 
    ctx.save();
    ctx.translate(midX + 12, 30);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'right';
    ctx.fillText('← PC2 (Variance)', 0, 0);
    ctx.restore();

    // 3. Draw Lasso if drawing
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
  }, [width, height, isDrawing]);

  // Initial draw and update on dimension change
  useEffect(() => {
    drawUI();
  }, [drawUI, width, height]);

  const drawLasso = () => {
    drawUI();
  };

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-black/20 rounded-xl overflow-hidden shadow-inner">
      {/* WebGL Layer - Points */}
      <canvas
        ref={glCanvasRef}
        width={width}
        height={height}
        className="absolute inset-0 z-0 w-full h-full"
      />

      {/* 2D Layer - Lasso Drawing */}
      <canvas
        ref={lassoCanvasRef}
        width={width}
        height={height}
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
  // Vertex shader
  const vertexShaderSource = `
    attribute vec2 a_position;
    attribute float a_selected;
    
    varying float v_selected;
    
    void main() {
      // Logic space is [-0.9, 0.9], draw directly to NDC
      gl_Position = vec4(a_position, 0.0, 1.0);
      gl_PointSize = 18.0; // Larger points for visibility
      v_selected = a_selected;
    }
  `;

  // Fragment shader
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
        gl_FragColor = vec4(1.0, 0.3, 0.3, alpha); // Bright Red
      } else {
        gl_FragColor = vec4(0.0, 0.8, 1.0, alpha); // Electric Cyan
      }
    }
  `;

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

  if (!vertexShader || !fragmentShader) {
    console.error('Failed to create shaders');
    return null;
  }

  const program = createProgram(gl, vertexShader, fragmentShader);
  if (!program) {
    console.error('Failed to create program');
    return null;
  }

  gl.useProgram(program);
  return program;

  // TODO: Set up vertex buffers from SharedArrayBuffer
}

function createShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader | null {
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

function createProgram(
  gl: WebGLRenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader
): WebGLProgram | null {
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
