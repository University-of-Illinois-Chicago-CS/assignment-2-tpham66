import vertexShaderSrc from './vertex.glsl.js';
import fragmentShaderSrc from './fragment.glsl.js'

var gl = null;
var vao = null;
var program = null;
var vertexCount = 0;
var uniformModelViewLoc = null;
var uniformProjectionLoc = null;
var heightmapData = null;
let rotationY = 0, rotationZ = 0;
let scale = 1.0;
let height = [1, 1, 1];
let eye = [0, 5, 5];
let target = [0, 0, 0];
const DEG_RAD = Math.PI / 180.0;

function processImage(img)
{
	// draw the image into an off-screen canvas
	var off = document.createElement('canvas');
	
	var sw = img.width, sh = img.height;
	off.width = sw; off.height = sh;
	
	var ctx = off.getContext('2d');
	ctx.drawImage(img, 0, 0, sw, sh);
	
	// read back the image pixel data
	var imgd = ctx.getImageData(0,0,sw,sh);
	var px = imgd.data;
	
	// create a an array will hold the height value
	var heightArray = new Float32Array(sw * sh);
	
	// loop through the image, rows then columns
	for (var y=0;y<sh;y++) 
	{
		for (var x=0;x<sw;x++) 
		{
			// offset in the image buffer
			var i = (y*sw + x)*4;
			
			// read the RGB pixel value
			var r = px[i+0], g = px[i+1], b = px[i+2];
			
			// convert to greyscale value between 0 and 1
			var lum = (0.2126*r + 0.7152*g + 0.0722*b) / 255.0;

			// store in array
			heightArray[y*sw + x] = lum;
		}
	}

	return {
		data: heightArray,
		width: sw,
		height: sh
	};
}

function buildTriangleMesh(heightmapData) {
  const W = heightmapData.width;
  const H = heightmapData.height;
  const D = heightmapData.data;

  // world coordinates will be in [-halfSpan,+halfSpan]
  const halfSpan = 2.0; 
  // size of each cell
  const cellSizeX = (2 * halfSpan) / (W - 1);
  const cellSizeZ = (2 * halfSpan) / (H - 1);
  // offsets to center the mesh at the origin
  const ox = (W - 1) * 0.5 * cellSizeX;
  const oz = (H - 1) * 0.5 * cellSizeZ;

  // bounding box of the mesh
  const xmin = -halfSpan, xmax = halfSpan;
  const zmin = -halfSpan, zmax = halfSpan;
  const ymin = 0, ymax = 1.0;

  // for color normalization
  const invX = 1.0 / (xmax - xmin || 1);
  const invY = 1.0 / (ymax - ymin || 1);
  const invZ = 1.0 / (zmax - zmin || 1);

  const positions = [];
  const colors = [];
  const idx = (r,c) => r * W + c;

  function emit(x,y,z) {
    positions.push(x,y,z);
    // normalize XYZ → RGB
    const xc = (x - xmin) * invX;
    const yc = (y - ymin) * invY;
    const zc = (z - zmin) * invZ;
    colors.push(xc, yc, zc, 1.0); // RGBA
  }

  for (let r = 0; r < H-1; r++) {
    for (let c = 0; c < W-1; c++) {
      const i00 = idx(r,c), i10 = idx(r,c+1);
      const i01 = idx(r+1,c), i11 = idx(r+1,c+1);

	  // corner positions
      const x00 = c*cellSizeX - ox, z00 = r*cellSizeZ - oz, y00 = D[i00];
      const x10 = (c+1)*cellSizeX - ox, z10 = z00, y10 = D[i10];
      const x01 = x00, z01 = (r+1)*cellSizeZ - oz, y01 = D[i01];
      const x11 = x10, z11 = z01, y11 = D[i11];

      // 2 triangles per quad
      emit(x00,y00,z00); emit(x01,y01,z01); emit(x10,y10,z10);
      emit(x10,y10,z10); emit(x01,y01,z01); emit(x11,y11,z11);
    }
  }

  return {
    positions: new Float32Array(positions),
    colors:    new Float32Array(colors),
    vertexCount: positions.length / 3
  };
}

window.loadImageFile = function(event)
{

	var f = event.target.files && event.target.files[0];
	if (!f) return;
	
	// create a FileReader to read the image file
	var reader = new FileReader();
	reader.onload = function() 
	{
		// create an internal Image object to hold the image into memory
		var img = new Image();
		img.onload = function() 
		{
			// heightmapData is globally defined
			heightmapData = processImage(img);
			
			
			/*
				TODO: using the data in heightmapData, create a triangle mesh
					heightmapData.data: array holding the actual data, note that 
					this is a single dimensional array the stores 2D data in row-major order

					heightmapData.width: width of map (number of columns)
					heightmapData.height: height of the map (number of rows)
			*/
			const mesh = buildTriangleMesh(heightmapData);
			vertexCount = mesh.vertexCount;

			const posBuffer = createBuffer(gl, gl.ARRAY_BUFFER, mesh.positions);
			const colorBuffer = createBuffer(gl, gl.ARRAY_BUFFER, mesh.colors);
			const posAttribLoc = gl.getAttribLocation(program, "position");
			const colorAttribLoc = gl.getAttribLocation(program, "color");
			vao = createVAO(gl, 
				// positions
				posAttribLoc, posBuffer, 

				// normals (unused in this assignments)
				null, null, 

				// colors (not needed--computed by shader)
				colorAttribLoc, colorBuffer
			);
			requestAnimationFrame(draw);
			
			console.log('loaded image: ' + heightmapData.width + ' x ' + heightmapData.height);

		};
		img.onerror = function() 
		{
			console.error("Invalid image file.");
			alert("The selected file could not be loaded as an image.");
		};

		// the source of the image is the data load from the file
		img.src = reader.result;
	};
	reader.readAsDataURL(f);
}
function setupViewMatrix(eye, target)
{
    var forward = normalize(subtract(target, eye));
    var upHint  = [0, 1, 0];

    var right = normalize(cross(forward, upHint));
    var up    = cross(right, forward);

    var view = lookAt(eye, target, up);
    return view;

}
function panCamera(deltaX, deltaY) {
	eye    = add(eye, [deltaX * 0.001, 0, deltaY * 0.001]);
	target = add(target, [deltaX * 0.001, 0, deltaY * 0.001]);
}
function draw()
{
	var fovRadians = 70 * Math.PI / 180;
	var aspectRatio = +gl.canvas.width / +gl.canvas.height;
	var nearClip = 0.001;
	var farClip = 20.0;

	var projectionMatrix;
	if (document.querySelector("#projection").value == 'perspective')
	{
		// perspective projection
		projectionMatrix= perspectiveMatrix(
			fovRadians,
			aspectRatio,
			nearClip,
			farClip,
		);
	}
	else {
		// orthographic projection 
		projectionMatrix = orthographicMatrix(-5*aspectRatio, 5*aspectRatio, -5, 5, nearClip, farClip);
	}

	// Set up transormation
	// Rotation around Y axis
	var value = parseInt(document.querySelector("#yrotation").value);
	rotationY = rotateYMatrix(value * DEG_RAD);
	// Rotation around Z axis
	value = parseInt(document.querySelector("#zrotation").value);
	rotationZ = rotateZMatrix(value * DEG_RAD);
	// Set up scale
	value = parseInt(document.querySelector("#scale").value);
	scale = scaleMatrix(value, value, value);
	// Change height of terrain
	var newHeight = parseInt(document.getElementById("height").value);	
	height = scaleMatrix(1, newHeight/100, 1);

	var modelMatrix = multiplyArrayOfMatrices([height, scale, rotationY, rotationZ]);
	
	// setup viewing matrix
	var eyeToTarget = subtract(target, eye);
	var viewMatrix = setupViewMatrix(eye, target);

	// model-view Matrix = view * model
	var modelviewMatrix = multiplyMatrices(viewMatrix, modelMatrix);


	// enable depth testing
	gl.enable(gl.DEPTH_TEST);

	// disable face culling to render both sides of the triangles
	gl.disable(gl.CULL_FACE);

	gl.clearColor(0.2, 0.2, 0.2, 1);
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

	gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
	gl.useProgram(program);
	
	// update modelview and projection matrices to GPU as uniforms
	gl.uniformMatrix4fv(uniformModelViewLoc, false, new Float32Array(modelviewMatrix));
	gl.uniformMatrix4fv(uniformProjectionLoc, false, new Float32Array(projectionMatrix));

	gl.bindVertexArray(vao);
	
	var primitiveType = gl.TRIANGLES;
	gl.drawArrays(primitiveType, 0, vertexCount);

	requestAnimationFrame(draw);

}

var isDragging = false;
var startX, startY;
var leftMouse = false;

function addMouseCallback(canvas)
{
	isDragging = false;

	canvas.addEventListener("mousedown", function (e) 
	{
		if (e.button === 0) {
			console.log("Left button pressed");
			leftMouse = true;
		} else if (e.button === 2) {
			console.log("Right button pressed");
			leftMouse = false;
		}

		isDragging = true;
		startX = e.offsetX;
		startY = e.offsetY;
	});

	canvas.addEventListener("contextmenu", function(e)  {
		e.preventDefault(); // disables the default right-click menu
	});

	canvas.addEventListener("wheel", function(e)  {
		e.preventDefault(); // prevents page scroll

		const zoom = document.getElementById("scale");
		if (e.deltaY < 0) {
			// zoom in
			zoom.stepUp();
		} else {
			// zoom out
			zoom.stepDown();
		}
		scale = scaleMatrix(zoom.value, zoom.value, zoom.value);
	}, { passive: false });

	document.addEventListener("mousemove", function (e) {
		if (!isDragging) return;
		var currentX = e.offsetX;
		var currentY = e.offsetY;

		var deltaX = currentX - startX;
		var deltaY = currentY - startY;

		// implement dragging logic
		if (leftMouse) {
			// Rotation around Y and Z
			rotationY = rotateYMatrix(Math.max(0, Math.min(360, deltaX)) * DEG_RAD);
			rotationZ = rotateZMatrix(Math.max(0, Math.min(360, deltaY)) * DEG_RAD);
			// update slider values
			document.querySelector("#yrotation").value = deltaX;
			document.querySelector("#zrotation").value = deltaY;
			console.log('rotate: ' + deltaX + ', ' + deltaY);
		} else {
			// pan the image in the X-Z plane
			panCamera(deltaX, deltaY);
		}

	});

	document.addEventListener("mouseup", function () {
		isDragging = false;
	});

	document.addEventListener("mouseleave", () => {
		isDragging = false;
	});
}

function initialize() 
{
	var canvas = document.querySelector("#glcanvas");
	canvas.width = canvas.clientWidth;
	canvas.height = canvas.clientHeight;

	gl = canvas.getContext("webgl2");

	// add mouse callbacks
	addMouseCallback(canvas);

	var vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSrc);
	var fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSrc);
	program = createProgram(gl, vertexShader, fragmentShader);

	// uniforms
	uniformModelViewLoc = gl.getUniformLocation(program, 'modelview');
	uniformProjectionLoc = gl.getUniformLocation(program, 'projection');
}

window.onload = initialize();