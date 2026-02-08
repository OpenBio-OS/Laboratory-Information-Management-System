// WebGL Scatter Plot Renderer
// Zone D: Uses SharedArrayBuffers as Vertex Buffer Objects

import { useEffect, useRef, useState } from 'react';

interface ScatterPlotProps {
  width: number;
  height: number;
  onLassoComplete?: (points: Float32Array) => void;
}

export function ScatterPlot({ width, height, onLassoComplete }: ScatterPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const lassoPoints = useRef<number[]>([]);

  // Initialize WebGL
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl');
    if (!gl) {
      console.error('WebGL not supported');
      return;
    }

    glRef.current = gl;

    // Set up viewport
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.1, 0.1, 0.1, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // TODO: Initialize shaders and buffers
    initializeShaders(gl);
  }, [width, height]);

  // Handle lasso drawing
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    lassoPoints.current = [];
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      lassoPoints.current.push(x, y);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      lassoPoints.current.push(x, y);

      // Draw lasso path
      drawLasso();
    }
  };

  const handleMouseUp = () => {
    if (isDrawing && lassoPoints.current.length > 2) {
      setIsDrawing(false);

      // Convert screen coordinates to normalized device coordinates
      const normalizedPoints = new Float32Array(lassoPoints.current.length);
      for (let i = 0; i < lassoPoints.current.length; i += 2) {
        normalizedPoints[i] = (lassoPoints.current[i] / width) * 2 - 1;
        normalizedPoints[i + 1] = 1 - (lassoPoints.current[i + 1] / height) * 2;
      }

      // Send to parent (which will forward to Web Worker)
      onLassoComplete?.(normalizedPoints);
    }
    
    lassoPoints.current = [];
  };

  const drawLasso = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    if (lassoPoints.current.length < 2) return;

    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lassoPoints.current[0], lassoPoints.current[1]);
    
    for (let i = 2; i < lassoPoints.current.length; i += 2) {
      ctx.lineTo(lassoPoints.current[i], lassoPoints.current[i + 1]);
    }
    
    ctx.stroke();
  };

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="cursor-crosshair"
      />
      {isDrawing && (
        <div className="absolute top-2 left-2 bg-black/70 text-white px-2 py-1 text-sm rounded">
          Drawing lasso...
        </div>
      )}
    </div>
  );
}

function initializeShaders(gl: WebGLRenderingContext) {
  // Vertex shader
  const vertexShaderSource = `
    attribute vec2 a_position;
    attribute float a_selected;
    
    varying float v_selected;
    
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      gl_PointSize = 3.0;
      v_selected = a_selected;
    }
  `;

  // Fragment shader
  const fragmentShaderSource = `
    precision mediump float;
    varying float v_selected;
    
    void main() {
      if (v_selected > 0.5) {
        gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); // Red for selected
      } else {
        gl_FragColor = vec4(0.5, 0.5, 0.5, 0.8); // Gray for unselected
      }
    }
  `;

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

  if (!vertexShader || !fragmentShader) {
    console.error('Failed to create shaders');
    return;
  }

  const program = createProgram(gl, vertexShader, fragmentShader);
  if (!program) {
    console.error('Failed to create program');
    return;
  }

  gl.useProgram(program);
  
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
