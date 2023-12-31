var state = {};
var game;
var sceneFile = "scene.json"; // can change this to be the name of your scene

// This function loads on window load, uses async functions to load the scene then try to render it
window.onload = async () => {
    try {
        console.log("Starting to load scene file");
        await parseSceneFile(`./statefiles/${sceneFile}`, state);
        main();
    } catch (err) {
        console.error(err);
        alert(err);
    }
}

/**
 * 
 * @param {object - contains vertex, normal, uv information for the mesh to be made} mesh 
 * @param {object - the game object that will use the mesh information} object 
 * @purpose - Helper function called as a callback function when the mesh is done loading for the object
 */
async function createMesh(mesh, object, vertShader, fragShader) {
    let testModel = new Model(state.gl, object, mesh);
    testModel.vertShader = vertShader ? vertShader : state.vertShaderSample;
    testModel.fragShader = fragShader ? fragShader : state.fragShaderSample;
    await testModel.setup();
    addObjectToScene(state, testModel);
    return testModel;
}

/**
 * Main function that gets called when the DOM loads
 */
async function main() {
    //document.body.appendChild( stats.dom );
    const canvas = document.querySelector("#glCanvas");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Initialize the WebGL2 context
    var gl = canvas.getContext("webgl2");

    // Only continue if WebGL2 is available and working
    if (gl === null) {
        printError('WebGL 2 not supported by your browser',
            'Check to see you are using a <a href="https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API#WebGL_2_2" class="alert-link">modern browser</a>.');
        return;
    }

    /**
     * Sample vertex and fragment shader here that simply applies MVP matrix 
     * and diffuse colour of each object
     */
    const vertShaderSample =
        `#version 300 es
        in vec3 aPosition;
        in vec3 aNormal;
        in vec2 aUV;

        uniform mat4 uProjectionMatrix;
        uniform mat4 uViewMatrix;
        uniform mat4 uModelMatrix;

        uniform mat4 normalMatrix;
	    uniform vec3 uCameraPosition;

        out vec3 oNormal;
        out vec2 oUV;
        out vec3 oFragPosition;
        out vec3 oCameraPosition;

        void main() {
            
            // Postion of the fragment in world space
            gl_Position = uProjectionMatrix * uViewMatrix * uModelMatrix * vec4(aPosition, 1.0);

            oUV = aUV;
            oFragPosition = (uModelMatrix * vec4(aPosition, 1.0)).xyz;
            oNormal = normalize((normalMatrix * vec4(aNormal, 0.0)).xyz);

            oCameraPosition = uCameraPosition;
        }
        `;















    const fragShaderSample =
        `#version 300 es
        #define MAX_LIGHTS 20
        precision highp float;

        struct PointLight{
            vec3 position;
            vec3 colour;
            float strength;
            float linear;
            float quadratic;
        };

        
        uniform int numLights; // The number of lights currently active
        uniform PointLight pointLights[MAX_LIGHTS];

        uniform PointLight mainLight;

        // from fsShader
        in vec3 oNormal;
        in vec3 oFragPosition;
        in vec3 oCameraPosition;

        in vec2 oUV;

        uniform int samplerExists;
        uniform sampler2D uTexture;

        uniform vec3 ambientVal;
        uniform vec3 diffuseVal;
        uniform vec3 specularVal;
        uniform float nVal;
        uniform float alphaValue;

        

        out vec4 fragColor;

        vec3 calculateColour(PointLight light, vec3 normal, vec3 fragPosition, vec3 viewDir, vec3 ambientVal, vec3 diffuseVal, vec3 specularVal, float nVal, float alphaValue, int samplerExists, vec3 textureColor) {
            
            vec3 empty = vec3(0.0,0.0,0.0);
            float dist = length(light.position - fragPosition);

            float interpFactor = max(1.0 - dist/(light.strength*30.0), 0.0);

            // save some resources and stop while you don't need to light anything.
            if (!(interpFactor > 0.0)) {
                return empty;
            }

            vec3 lightDir = normalize(light.position - fragPosition);
            vec3 halfwayDir = normalize(lightDir + viewDir);

            vec3 ambient = ambientVal * light.colour;

            float diff = max(dot(normal, lightDir), 0.0);
            vec3 diffuse = diff * diffuseVal * light.colour;

            float spec = pow(max(dot(halfwayDir, normal), 0.0), nVal);
            vec3 specular = spec * specularVal * light.colour;

            float attenuation = light.strength / (1.0 + light.linear * dist + light.quadratic * (dist*dist));

            diffuse *= attenuation;
            specular *= attenuation;

            vec3 totalCol = empty;
            if (samplerExists == 1) {
                totalCol = (mix(textureColor, ambient + diffuse, 0.6) + specular);
            } else totalCol = (ambient + diffuse + specular);

            // make it so lights don't go forever
            return mix(empty, totalCol, interpFactor);

            return totalCol;
            
        }


        void main() {

            vec3 normal = normalize(oNormal);
            vec3 viewDir = normalize(oCameraPosition - oFragPosition);
            
            vec3 textureColor = vec3(0.0);
            if (samplerExists == 1) {
                //ambientVal = mix(texture(uTexture, oUV).rgb, diffuseVal, 0.1);
                textureColor = texture(uTexture, oUV).rgb;
            }

            // initialize to zero so we can add onto it later.
            // loop for as many lights as we have and calculate their lighting.
            vec3 totalLighting = vec3(0.0);
            for (int i = 0; i < numLights; i++) {
                totalLighting += calculateColour(pointLights[i], normal, oFragPosition, viewDir, ambientVal, diffuseVal, specularVal, nVal, alphaValue, samplerExists, textureColor);
            }
            
            fragColor = vec4(totalLighting, alphaValue);

        }
        `;

    /**
     * Initialize state with new values (some of these you can replace/change)
     */
    state = {
        ...state, // this just takes what was already in state and applies it here again
        gl,
        vertShaderSample,
        fragShaderSample,
        canvas: canvas,
        objectCount: 0,
        lightIndices: [],
        keyboard: {},
        mouse: { sensitivity: 0.2 },
        meshCache: {},
        samplerExists: 0,
        samplerNormExists: 0,
    };

    state.numLights = state.pointLights.length;
    //console.log(state.numLights);

    const now = new Date();
    console.log(state.loadObjects.length);
    for (let i = 0; i < state.loadObjects.length; i++) {
        const object = state.loadObjects[i];

        if (object.type === "mesh") {
            await addMesh(object);
        } else if (object.type === "cube") {
            addCube(object, state);
        } else if (object.type === "plane") {
            addPlane(object, state);
        } else if (object.type.includes("Custom")) {
            addCustom(object, state);
        }
    }

    const then = new Date();
    const loadingTime = (then.getTime() - now.getTime()) / 1000;
    console.log(`Scene file loaded in ${loadingTime} seconds.`);

    game = new Game(state);
    await game.onStart();
    loadingPage.remove();
    startRendering(gl, state); // now that scene is setup, start rendering it
}

/**
 * 
 * @param {object - object containing scene values} state 
 * @param {object - the object to be added to the scene} object 
 * @purpose - Helper function for adding a new object to the scene and refreshing the GUI
 */
function addObjectToScene(state, object) {
    object.name = object.name;
    state.objects.push(object);
}

/**
 * 
 * @param {gl context} gl 
 * @param {object - object containing scene values} state 
 * @purpose - Calls the drawscene per frame
 */
function startRendering(gl, state) {
    // A variable for keeping track of time between frames
    var then = 0.0;

    // This function is called when we want to render a frame to the canvas
    function render(now) {
        now *= 0.001; // convert to seconds
        const deltaTime = now - then;
        then = now;

        state.deltaTime = deltaTime;
        drawScene(gl, deltaTime, state);
        game.onUpdate(deltaTime); //constantly call our game loop

        // Request another frame when this one is done
        requestAnimationFrame(render);
    }
    // Draw the scene
    requestAnimationFrame(render);
}

/**
 * 
 * @param {gl context} gl 
 * @param {float - time from now-last} deltaTime 
 * @param {object - contains the state for the scene} state 
 * @purpose Iterate through game objects and render the objects aswell as update uniforms
 */
function drawScene(gl, deltaTime, state) {
    gl.clearColor(state.settings.backgroundColor[0], state.settings.backgroundColor[1], state.settings.backgroundColor[2], 1.0); // Here we are drawing the background color that is saved in our state
    gl.enable(gl.DEPTH_TEST); // Enable depth testing
    gl.depthFunc(gl.LEQUAL); // Near things obscure far things
    gl.disable(gl.CULL_FACE); // Cull the backface of our objects to be more efficient
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.clearDepth(1.0); // Clear everything
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // sort objects by nearness to camera
    let sorted = state.objects.sort((a, b) => {

        // keep plane in back at all times!
        // comparing with a string is inefficient, int would be better
        if (a.type == "plane") {
            return -1;
        }

        if (b.type == "plane") {
            return 1;
        }

        let aCentroidFour = vec4.fromValues(a.centroid[0], a.centroid[1], a.centroid[2], 1.0);
        // fixed a bug
        vec4.transformMat4(aCentroidFour, aCentroidFour, a.model.modelMatrix);

        let bCentroidFour = vec4.fromValues(b.centroid[0], b.centroid[1], b.centroid[2], 1.0);
        vec4.transformMat4(bCentroidFour, bCentroidFour, b.model.modelMatrix);

        return vec3.distance(state.camera.position, vec3.fromValues(aCentroidFour[0], aCentroidFour[1], aCentroidFour[2]))
            >= vec3.distance(state.camera.position, vec3.fromValues(bCentroidFour[0], bCentroidFour[1], bCentroidFour[2])) ? -1 : 1;
    });

    // iterate over each object and render them
    sorted.map((object) => {
        gl.useProgram(object.programInfo.program);
        {
            // Projection Matrix ....
            let projectionMatrix = mat4.create();
            let fovy = 90.0 * Math.PI / 180.0; // Vertical field of view in radians
            let aspect = state.canvas.clientWidth / state.canvas.clientHeight; // Aspect ratio of the canvas
            let near = 0.1; // Near clipping plane
            let far = 1000000.0; // Far clipping plane

            mat4.perspective(projectionMatrix, fovy, aspect, near, far);
            gl.uniformMatrix4fv(object.programInfo.uniformLocations.projection, false, projectionMatrix);
            state.projectionMatrix = projectionMatrix;

            // View Matrix & Camera ....
            let viewMatrix = mat4.create();
            let camFront = vec3.fromValues(0, 0, 0);
            vec3.add(camFront, state.camera.position, state.camera.front);
            mat4.lookAt(
                viewMatrix,
                state.camera.position,
                camFront,
                state.camera.up,
            );
            gl.uniformMatrix4fv(object.programInfo.uniformLocations.view, false, viewMatrix);
            gl.uniform3fv(object.programInfo.uniformLocations.cameraPosition, state.camera.position);
            state.viewMatrix = viewMatrix;

            // Model Matrix ....
            let modelMatrix = mat4.create();
            if (object.parent) {
                let parent = object.parent;
                console.log("Parent: ", object.parent);
                if (!(parent.model == null) && parent.model.modelMatrix) {
                    mat4.multiply(modelMatrix, parent.model.modelMatrix, modelMatrix);
                }
            }

            mat4.translate(modelMatrix, modelMatrix, object.model.position);

            mat4.translate(modelMatrix, modelMatrix, object.centroid);

            mat4.mul(modelMatrix, modelMatrix, object.model.rotation);

            mat4.scale(modelMatrix, modelMatrix, object.model.scale);

            let negCentroid = vec3.fromValues(0.0, 0.0, 0.0);
            vec3.negate(negCentroid, object.centroid);
            mat4.translate(modelMatrix, modelMatrix, negCentroid);
            
            object.model.modelMatrix = modelMatrix;
            gl.uniformMatrix4fv(object.programInfo.uniformLocations.model, false, modelMatrix);

            // Normal Matrix ....
            let normalMatrix = mat4.create();
            mat4.invert(normalMatrix, modelMatrix);
            mat4.transpose(normalMatrix, normalMatrix);
            gl.uniformMatrix4fv(object.programInfo.uniformLocations.normalMatrix, false, normalMatrix);

            // Object material
            gl.uniform3fv(object.programInfo.uniformLocations.diffuseVal, object.material.diffuse);
            gl.uniform3fv(object.programInfo.uniformLocations.ambientVal, object.material.ambient);
            gl.uniform3fv(object.programInfo.uniformLocations.specularVal, object.material.specular);
            gl.uniform1f(object.programInfo.uniformLocations.nVal, object.material.n);
            gl.uniform1f(object.programInfo.uniformLocations.alphaValue, object.material.alpha);

            state.numLights = state.pointLights.length;
            gl.uniform1i(gl.getUniformLocation(object.programInfo.program, 'numLights'), state.numLights);
            
            object.numLights = state.numLights;

            gl.uniform1i(object.programInfo.uniformLocations.numLights, state.numLights);
            if (state.pointLights.length > 0) {
                object.programInfo.uniformLocations.pointLights = [];
                for (let i = 0; i < state.pointLights.length; i++) {
                    gl.uniform3fv(gl.getUniformLocation(object.programInfo.program, 'pointLights[' + i + '].position'), state.pointLights[i].position);
                    gl.uniform3fv(gl.getUniformLocation(object.programInfo.program, 'pointLights[' + i + '].colour'), state.pointLights[i].colour);
                    gl.uniform1f(gl.getUniformLocation(object.programInfo.program, 'pointLights[' + i + '].strength'), state.pointLights[i].strength);
                    gl.uniform1f(gl.getUniformLocation(object.programInfo.program, 'pointLights[' + i + '].linear'), state.pointLights[i].linear);
                    gl.uniform1f(gl.getUniformLocation(object.programInfo.program, 'pointLights[' + i + '].quadratic'), state.pointLights[i].quadratic);
                }
            }


            {
                // Bind the buffer we want to draw
                gl.bindVertexArray(object.buffers.vao);

                //check for diffuse texture and apply it
                if (object.material.shaderType === 3) {
                    state.samplerExists = 1;
                    gl.activeTexture(gl.TEXTURE0);
                    gl.uniform1i(object.programInfo.uniformLocations.samplerExists, state.samplerExists);
                    gl.uniform1i(object.programInfo.uniformLocations.sampler, 0);
                    gl.bindTexture(gl.TEXTURE_2D, object.model.texture);
                } else {
                    gl.activeTexture(gl.TEXTURE0);
                    state.samplerExists = 0;
                    gl.uniform1i(object.programInfo.uniformLocations.samplerExists, state.samplerExists);
                }

                //check for normal texture and apply it
                if (object.material.shaderType === 4) {
                    state.samplerNormExists = 1;
                    gl.activeTexture(gl.TEXTURE1);
                    gl.uniform1i(object.programInfo.uniformLocations.normalSamplerExists, state.samplerNormExists);
                    gl.uniform1i(object.programInfo.uniformLocations.normalSampler, 1);
                    gl.bindTexture(gl.TEXTURE_2D, object.model.textureNorm);
                } else {
                    gl.activeTexture(gl.TEXTURE1);
                    state.samplerNormExists = 0;
                    gl.uniform1i(object.programInfo.uniformLocations.normalSamplerExists, state.samplerNormExists);
                }

                //console.log(object.material.alpha);
                if (object.material.alpha < 1.0) {
				
                    // no z buffer, apply blending and blend function
                    gl.enable(gl.BLEND);
                    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

                    gl.enable(gl.DEPTH_TEST);
                    gl.depthMask(false);

                } else {
                    
                    // enable z buffer
                    gl.disable(gl.BLEND);
                    // I guess we never disable the depth test?
                    gl.enable(gl.DEPTH_TEST);
                    gl.depthMask(true);
                    gl.depthFunc(gl.LEQUAL);
                
                }

                // Draw the object
                const offset = 0; // Number of elements to skip before starting

                //if its a mesh then we don't use an index buffer and use drawArrays instead of drawElements
                if (object.type === "mesh" || object.type === "meshCustom") {
                    gl.drawArrays(gl.TRIANGLES, offset, object.buffers.numVertices / 3);
                } else {
                    gl.drawElements(gl.TRIANGLES, object.buffers.numVertices, gl.UNSIGNED_SHORT, offset);
                }
            }
        }
    });
}
