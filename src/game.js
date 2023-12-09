class Game {


    static ColliderTypes = {
        SPHERE: 1,
        OBB: 2
    };
    
    constructor(state) {
        this.state = state;
        this.spawnedObjects = [];
        this.projectiles = [];
        this.collidableObjects = [];
        this.enemyList = [];
        this.elapsedTimeSinceSpawn = 0.0;
        this.elapsedTimeSinceHealth = 0.0;

        this.firstPerson = false;
        this.cameraToggleDown = false;

        this.totalTime = 0.0;

        // keystates is for all keyboard input
        this.keyStates = {};

        // mousestates is for mouse1 2 and 3 and will be used for attacking
        this.mouseStates = {
            left: false,
            right: false,
            middle: false
        };

        // this mouseposition will be used to find the trace for where to shoot
        this.mousePosition = {
            x: 0,
            y: 0
        };

        // we use this to keep tracking of whether we're attacking. This is
        // used to make sure we only have one attack per mouse click.
        this.gamevars = {};
        this.gamevars.attacking = false;
        
        // new collision types, for spheres, spheres+polygons and polygons+polygons
        // for efficiency we should mostly use sphere hit detection.
        // Also, object position seems to have volatile values. I used centroid instead.
        this.collisionType = {
            // use bitwise or for an efficient comparison.
            [Game.ColliderTypes.SPHERE | Game.ColliderTypes.SPHERE]: this.checkSphereCollision,
            [Game.ColliderTypes.SPHERE | Game.ColliderTypes.OBB]: this.checkSphereOBBCollision,
            [Game.ColliderTypes.OBB | Game.ColliderTypes.OBB]: this.checkOBBCollision
        };
    }

    eyeTraceToShootPlane(desiredY, screenX, screenY) {
        // https://stackoverflow.com/questions/53467077/opengl-ray-tracing-using-inverse-transformations
        // this was very helpful to bypass a more complex transformation chain. This is a much easier way to do it.
        // It just calculates two points using the inverse view proj matrix to basically simulate ray origin and scren pos.
        let proj = this.state.projectionMatrix;
        
        let viewMatrix = this.state.viewMatrix;
        let canvasX = this.state.canvas.width
        let canvasY = this.state.canvas.height

        // convert to screen coordinates
        const x = ((2.0 * screenX) / canvasX) - 1.0;
        const y = 1.0 - ((2.0 * screenY) / canvasY);

        let ray = vec4.fromValues(x, y, -1.0, 1.0);
        let ray2 = vec4.fromValues(x, y, 1.0, 1.0);

        let inverseViewProjectionMatrix = mat4.create();
        mat4.multiply(inverseViewProjectionMatrix, proj, viewMatrix);
        mat4.invert(inverseViewProjectionMatrix, inverseViewProjectionMatrix);

        let nearPointWorld = vec4.create();
        vec4.transformMat4(nearPointWorld, ray, inverseViewProjectionMatrix);

        let farPointWorld = vec4.create();
        vec4.transformMat4(farPointWorld, ray2, inverseViewProjectionMatrix);

        // Scale the points to homogenize (convert from vec4 to vec3)
        let nearPointWorld3 = vec3.fromValues(nearPointWorld[0], nearPointWorld[1], nearPointWorld[2]);
        vec3.scale(nearPointWorld3, nearPointWorld3, 1 / nearPointWorld[3]);

        let farPointWorld3 = vec3.fromValues(farPointWorld[0], farPointWorld[1], farPointWorld[2]);
        vec3.scale(farPointWorld3, farPointWorld3, 1 / farPointWorld[3]);

        // Calculate the ray direction
        let rayDirection = vec3.create();
        vec3.subtract(rayDirection, farPointWorld3, nearPointWorld3);
        vec3.normalize(rayDirection, rayDirection);

        let t = (desiredY - this.state.camera.position[1]) / rayDirection[1];

        let intersectionPoint = vec3.create();
        vec3.scaleAndAdd(intersectionPoint, this.state.camera.position, rayDirection, t);

        return intersectionPoint;

        // now that we have the ray direction, we need to take the camera position
        // and add solve for the same Z from cameraPos*n*rayDirection.z = player.centroid.z
    }

    // example - create a collider on our object with various fields we might need (you will likely need to add/remove/edit how this works)
    createSphereCollider(object, radius, onCollide = null) {
        object.collider = {
            type: 1,
            radius: radius,
            onCollide: onCollide ? onCollide : (otherObject) => {
                //console.log(`Collided with ${otherObject.name}`);
            }
        };
        this.collidableObjects.push(object);
    }

    // Creates a collider for an object using min max coordinates.
    // An OBB is object bounding box, I learned about this back
    // when I made scripts for another game! You have OBB min and max
    // which means our hitbox is always a cube.
    createOBBCollider(object, minmax, onCollide = null) {
        object.collider = {
            type: 2,
            min: minmax.min,
            max: minmax.max,
            onCollide: onCollide ? onCollide : (otherObject) => {
                //console.log(`Collided with ${otherObject.name}`);
            }
        };
        this.collidableObjects.push(object);
    }

    // this is where we find our mins and maxes. What this does, is it takes
    // the min and max values of our polygon in X Y Z and essentially creates a cube
    // out of them. 
    getOBBsMinMax(object) {
        // Assuming object.model.vertices is an array of vec3s
        let min = vec3.fromValues(Infinity, Infinity, Infinity);
        let max = vec3.fromValues(-Infinity, -Infinity, -Infinity);

        let vertices = object.model.vertices;
    
        for (let i = 0; i < vertices.length; i += 3) {
            let vertex = vec3.fromValues(vertices[i], vertices[i + 1], vertices[i + 2]);
            let transformedVertex = vec3.create();

            vec3.transformMat4(transformedVertex, vertex, object.model.modelMatrix);
            // idk why but these guys' transformations are multiplying together. EVerything else works well.
            if (!(object.isWall)) {

                // wow there's a whole extra set of steps to add initial transformations, that really cost me
                // a lot of extra time.
                let modelMatrix = mat4.create();
                let negCentroid = vec3.fromValues(0.0, 0.0, 0.0);
                vec3.negate(negCentroid, object.centroid);
                mat4.translate(modelMatrix, modelMatrix, object.model.position);
                mat4.translate(modelMatrix, modelMatrix, object.centroid);
                mat4.mul(modelMatrix, modelMatrix, object.model.rotation);
                mat4.scale(modelMatrix, modelMatrix, object.model.scale);
                mat4.translate(modelMatrix, modelMatrix, negCentroid);
                
                vec3.transformMat4(transformedVertex, transformedVertex, modelMatrix);
            }
            
            vec3.min(min, min, transformedVertex);
            vec3.max(max, max, transformedVertex);
        }

        return { min, max };
    }

    // accepts a 2 item array of coordinates. We use this to automatically create
    // the radius for collision for spheres or any other object we want to make
    // a spherical hitbox for. For many cases, we can just input a value.
    getSphereRadiusFromAABB(minmax) {
        let min = minmax.min;
        let max = minmax.max;
        // Calculate the dimensions of the AABB
        let aabbWidth = max[0] - min[0];
    
        // Since the AABB of a sphere is a cube, we can use any dimension
        // Divide by 2 to get the radius
        let radius = aabbWidth / 2; // or aabbHeight / 2 or aabbDepth / 2

        return radius;
    }


    // checks the collision between types. Uses bitwise or to verify all
    // 3 cases, 1, 2 and 3. 1 is sphere-sphere, 2 is sphere-polygon, and 3 is polygon-polygon.
    checkCollision(object) {
        // store type1 so we don't make repetitive calls to it.
        let type1 = object.collider.type;

        this.collidableObjects.forEach(otherObject => {
            if (otherObject !== object) {
                let collisionKey = type1 | otherObject.collider.type;
                let collisionType = this.collisionType[collisionKey];

                if (collisionType) {
                    let collisionResult = collisionType.call(this, object, otherObject);
                    if (collisionResult) {
                        object.collider.onCollide(otherObject);
                    } // nothing for else

                }
            }
        });
    }

    // Checks for collisions between two spheres. This is relatively simple. I changed it so that it uses the centroids
    // since collision values are all over the place (go ahead and print otherObject.position and see for yourself)
    // this version is from Dr. Cobzas' solution.
    checkSphereCollision(object, otherObject) {
        // Existing sphere-to-sphere collision detection logic

        let position1 = vec3.create();
        vec3.transformMat4(position1, object.centroid, object.model.modelMatrix);

        let position2 = vec3.create();
        vec3.transformMat4(position2, otherObject.centroid, otherObject.model.modelMatrix);

        let distance = vec3.distance(position1, position2);

        // check if the object isnt colliding with itself and that the distance is less than the 2 radius values combined
        if (otherObject !== object && (distance < (object.collider.radius + otherObject.collider.radius))) {
            object.collider.onCollide(otherObject);
        }
    }

    // makes code nicer below
    squared(v) {
        return v * v;
    }

    // Credit: https://stackoverflow.com/questions/4578967/cube-sphere-intersection-test
    // this is a condensed version of X^2 + Y^2 + Z^2 = R^2. Using a clever math trick,
    // we subtract each one at a time to arrive at the equivalent of R^2 - (X^2 + Y^2 + Z^2) = 0.
    // If R^2 at the end is greater than zero, then we know we've found an intersect because 
    // the distances X Y and Z weren't big enough.

    // I found this solution online on a stackoverflow thread and it works well.
    checkSphereOBBCollision(object1, object2) {
        if (object1.collider.type !== Game.ColliderTypes.SPHERE) {
            [object1, object2] = [object2, object1];
        }
        
        let sphere = object1;
        let obb = object2;
        let R = sphere.collider.radius;
        let dist_squared = R * R;
        let S = vec3.create();
        vec3.transformMat4(S, sphere.centroid, sphere.model.modelMatrix);

        let { min: C1, max: C2 } = this.getOBBsMinMax(obb);

        // Check X axis
        if (S[0] < C1[0]) dist_squared -= this.squared(S[0] - C1[0]);
        else if (S[0] > C2[0]) dist_squared -= this.squared(S[0] - C2[0]);

        // Check Y axis
        if (S[1] < C1[1]) dist_squared -= this.squared(S[1] - C1[1]);
        else if (S[1] > C2[1]) dist_squared -= this.squared(S[1] - C2[1]);

        // Check Z axis
        if (S[2] < C1[2]) dist_squared -= this.squared(S[2] - C1[2]);
        else if (S[2] > C2[2]) dist_squared -= this.squared(S[2] - C2[2]);

        return (dist_squared > 0);
    }
    
    // check for overlap between two bounding boxes, this code shouldn't really be used
    // since we have all spheres and plus we don't want to deal with collisions between
    // two polygons cause that's resource intensive. Leaving it in just in case.
    checkOBBCollision(obb1, obb2) {
        // Retrieve the transformed min and max values for each OBB
        const obb1Bounds = this.getOBBsMinMax(obb1);
        const obb2Bounds = this.getOBBsMinMax(obb2);
    
        // Check for overlap along each axis
        const overlapX = obb1Bounds.max[0] >= obb2Bounds.min[0] && obb1Bounds.min[0] <= obb2Bounds.max[0];
        const overlapY = obb1Bounds.max[1] >= obb2Bounds.min[1] && obb1Bounds.min[1] <= obb2Bounds.max[1];
        const overlapZ = obb1Bounds.max[2] >= obb2Bounds.min[2] && obb1Bounds.min[2] <= obb2Bounds.max[2];
    
        return overlapX && overlapY && overlapZ;
    }

    // runs once on startup after the scene loads the objects
    async onStart() {
        console.log("On start");

        // this just prevents the context menu from popping up when you right click
        document.addEventListener("contextmenu", (e) => {
            e.preventDefault();

        }, false);

        // Create variables for our objects and create colliders for them. Collisions do work, see the console log for detection
        // of collisions between the player and all 4 walls.
        this.character = getObject(this.state, "playerModel");
        this.characterConstructor = state.loadObjects.find(obj => obj.name === "playerModel");

        this.defaultPlayerColorAmbient = this.characterConstructor.material.ambient;
        this.defaultPlayerColorDiffuse = this.characterConstructor.material.diffuse;
        this.character.hp = 100.0;
        this.createSphereCollider(this.character, this.getSphereRadiusFromAABB(this.getOBBsMinMax(this.character)), 

        (object) => {
            if (object.healthPack) {
                object.onCollide(this.character);
                //console.log(`Collected a healthpack! ${this.character.hp}`);
            }
            
        });
        this.character.collider.radius = 0.5 * this.character.collider.radius;

        this.surface = getObject(this.state, "surfacePlane");

        this.gamevars.minmax = this.getOBBsMinMax(this.surface);

        // make the plane follow the character then adjust its texture coordinates (this doesn't change any texture
        // coordinates yet it just parents the surface to the character)
        //this.surface.parent = this.character;
        //console.log("Parent: ", this.surface.parent);
        //vec3.subtract(this.surface.position, this.surface.position, vec3.fromValues(0.0,-10.0,0.0));
        //this.surface.translate(vec3.fromValues(0.0, -1.0, 0));

        this.frontWall = getObject(this.state, "frontWall");
        this.frontWall.isWall = true;
        this.createOBBCollider(this.frontWall, this.getOBBsMinMax(this.frontWall));

        this.backWall = getObject(this.state, "backWall");
        this.backWall.isWall = true;
        this.createOBBCollider(this.backWall, this.getOBBsMinMax(this.backWall));

        this.leftWall = getObject(this.state, "leftWall");
        this.leftWall.isWall = true;
        this.createOBBCollider(this.leftWall, this.getOBBsMinMax(this.leftWall));

        this.rightWall = getObject(this.state, "rightWall");
        this.rightWall.isWall = true;
        this.createOBBCollider(this.rightWall, this.getOBBsMinMax(this.rightWall));

        //this.enemyObject = getObject(this.state, "enemyModel");
        //this.gamevars.enemyDefaultRadius = this.getSphereRadiusFromAABB(this.getOBBsMinMax(this.enemyObject))

        // immediately remove enemy object so we can use the constructor instead later.
        // this is dumb lol
        this.enemyObject = getObject(this.state, "enemyModel");
        this.gamevars.enemyDefaultRadius = this.getSphereRadiusFromAABB(this.getOBBsMinMax(this.enemyObject))

        let array = state.objects;
        let arrayIndex = array.indexOf(this.enemyObject);
        if (arrayIndex > -1) { // only splice array when item is found
            state.objects.splice(arrayIndex, 1); // 2nd parameter means remove one item only
        }

        // reassign enemy object to the constructor
        this.enemyObject = state.loadObjects.find(obj => obj.name === "enemyModel");
        this.lightConstructor = state.pointLights.find(obj => obj.name === "pointLight1");

        // create references for our vars. One thing to note is that I can change
        // their contents because I'm not referencing a primitve. If this.keystates was an
        // integer, I would not be able to change it the same way.
        let keys = this.keyStates;
        let mouse = this.mouseStates;
        let mousePos = this.mousePosition;
        
        // use keydown instead of key press
        document.addEventListener("keydown", (e) => {
            e.preventDefault();

            if (!keys[e.key]) { keys[e.key] = true; }

        });

        // use keyup with keydown.
        document.addEventListener("keyup", (e) => {
            keys[e.key] = false;
        });

        // add mouse button tracking.
        document.addEventListener("mousedown", (e) => {
            if (e.button === 0) {
                mouse.left = true;
                // Handle left click press
                //console.log("left click pressed");
            } else if (e.button === 2) {
                mouse.right = true;
                //console.log("right click pressed");
                // Handle right click press
            } else if (e.button === 1) {
                mouse.middle = true;
                // Handle right click press
            }
        });

        // this detects when a mouse is no longer pressed
        document.addEventListener("mouseup", (e) => {
            if (e.button === 0) {
                mouse.left = false;
                // Handle left click release
            } else if (e.button === 2) {
                mouse.right = false;
                // Handle right click release
            } else if (e.button === 1) {
                mouse.middle = false;
                // Handle right click press
            }
        });

        // keep track of our mouse coordinates so we can trace it later. The plan is to find the intersection
        // between the camera through the screen (d) and intersect that with a plane that is level with the player's
        // eyes. This will make the character aim in 2D in our 3D game.
        document.addEventListener("mousemove", (e) => {
            mousePos.x = e.clientX;
            mousePos.y = e.clientY;
            // You can also handle the mouse move event here
            // For example, updating something on the screen in real-time
        });

    }

    // this is where we process input. We keep track of keys, etc. I have added some skeletons for
    // possible methods. So, from top to bottom.
    // - We send our keys to movecharacter and move the character accordingly.

    // - We check mousedown.right (as opposed to the next code block). This will be useful
    //   if we want the player to shoot a laser beam.

    // - We check if the player is not attacking. If the player isn't attacking and mouse1 or mouse3
    //   are active, then do a single attack for either one of them. This means that we only attack
    //   once per mouse click.
    processInput() {
        let keys = this.keyStates;
        let mousedown = this.mouseStates;
        let mousePos = this.mousePosition;
        let gamevars = this.gamevars;
        let attacking = gamevars.attacking;
        let firstperson = this.firstperson;
        let cameraToggleDown = this.cameraToggleDown;
        
        // toggle camera
        if (!cameraToggleDown) {
            if (keys["c"] || keys["C"]) {
                this.cameraToggleDown = true;
                this.firstperson = !firstperson
                //console.log(this.firstperson);
            }
        } else if (!keys["c"] && !keys["C"]) {
            this.cameraToggleDown = false;
        }
        
        for (const key in keys) {

            if (keys[key]) {
                this.moveCharacter(key);
            }
        }

        if (mousedown.right) {
            // do not check if attacking
            this.doAttack(2, mousePos);
        }

        if (!attacking) {
            if (mousedown.left) {
                this.doAttack(1, mousePos);
                gamevars.attacking = true;
            } else if (mousedown.middle) {
                this.doAttack(3, mousePos);
                gamevars.attacking = true;
            }
        } else if (!mousedown.left && !mousedown.middle) {
            gamevars.attacking = false;
        }

    }

    // skeleton for attack. We will use mousePos later to detect the player eye angle.
    doAttack(mouseKey, mousePos) {
        
        let object = this.character;

        let eyepos = object.model.position;

        let desiredY = eyepos[1]
        let shootpos = this.eyeTraceToShootPlane(desiredY, mousePos.x, mousePos.y);

        let direction = vec3.create();
        vec3.subtract(direction, shootpos, eyepos);

        vec3.normalize(direction, direction);

        // Define character movement based on the key
        switch (mouseKey) {
            case 1:
                
                //console.log("mouse1 down");
                this.spawnProjectile(eyepos, direction, 0.07)
                break;
            case 2:
                //console.log("mouse2 down");
                // shoot a laser??
                
                break;
            
            case 3:
                //console.log("mouse3 down");
                break;
            // Add other cases as needed
        }
    }

    // move the character. No more jagged teleporting.
    moveCharacter(key) {
        // Define character movement based on the key
        // fixed capslock issues, sorta.
        let minmax = this.gamevars.minmax;
        //console.log(minmax);
        let minx = minmax.min[0]
        let maxx = minmax.max[0]

        let minz = minmax.min[2]
        let maxz = minmax.max[2]

        switch (key) {
            case "a":
            case "A":
                this.character.translate(vec3.fromValues(0.1, 0, 0));
                break;
            case "d":
            case "D":
                this.character.translate(vec3.fromValues(-0.1, 0, 0));
                break;
            case "w":
            case "W":
                this.character.translate(vec3.fromValues(0, 0, 0.05));
                break;
            case "s":
            case "S":
                this.character.translate(vec3.fromValues(0, 0, -0.05));
                break;
            // Add other cases as needed
        }

        // Enforce min/max limits
    let pos = this.character.model.position;
    let radius = this.character.collider.radius * 2;
    //console.log(radius);
    pos[0] = Math.max(minx + radius*2, Math.min(pos[0], maxx - radius*2)); // Limit x
    pos[2] = Math.max(minz + radius, Math.min(pos[2], maxz - radius)); // Limit z
    
    // simple camera change
    if (!this.firstperson) {
        state.camera.position[0] = pos[0];
        state.camera.position = [pos[0], 7.0, -6.0];
        state.camera.front[1] = -2;
    } else {
        let newpos1 = pos[1] + 1;
        state.camera.front[1] = -1;
        state.camera.position = [pos[0], newpos1, pos[2]];
    }
    // Update character position
    this.character.model.position = pos;
    }

    // ------------------- Projectile Stuff ------------------ //
    spawnProjectile(origin, direction, speed) {
        let randomvac = randomVec3(0, 1);
        let tempObject = spawnObject({
            name: `Projectile${this.elapsedTime}`,
            type: "cube",
            material: {
                ambient: randomvac,
                diffuse: randomvac,
                specular: randomvac,

            },
            position: origin,
            scale: vec3.fromValues(0.5, 0.5, 0.5),
        }, this.state).then(tempObject => {

            let minmax = this.getOBBsMinMax(tempObject);

            tempObject.velocity = direction.map(a => a * speed)
            tempObject.translate(tempObject.centroid.map(element => element * -1));
            tempObject.isProjectile = true;
            tempObject.collidable = true;
            tempObject.onCollide = (object) => {

                // phase through players and healthpacks
                if ((object.name === "playerModel") || (object.healthPack)) {
                    return;
                }

                let collArray = this.collidableObjects;
                let collIndex = collArray.indexOf(tempObject);
                if (collIndex > -1) { // only splice array when item is found
                    collArray.splice(collIndex, 1); // 2nd parameter means remove one item only
                }

                let projArray = this.projectiles;
                let projIndex = projArray.indexOf(tempObject);
                if (projIndex > -1) { // only splice array when item is found
                    this.projectiles.splice(projIndex, 1); // 2nd parameter means remove one item only
                }

                let array = state.objects;
                let arrayIndex = array.indexOf(tempObject);
                if (arrayIndex > -1) { // only splice array when item is found
                    state.objects.splice(arrayIndex, 1); // 2nd parameter means remove one item only
                }
                
                if (object.hp !== undefined) {
                    object.hp -= 100;
                }

                //console.log(`I collided with ${object.name}!`);
            };

            this.createSphereCollider(tempObject, this.getSphereRadiusFromAABB(minmax),tempObject.onCollide);
            this.projectiles.push(tempObject); // add to spawned objects list
        });
    }
    
    moveProjectiles(deltaTime) {
        this.projectiles.forEach((object) => {
            object.translate(object.velocity);
            object.rotate('y', deltaTime * 5*Math.random());
            this.checkCollision(object);
        });
    }

    // ------------------- Enemy Stuff ------------------ //

    spawnEnemy(offset) {
        let tempObject = spawnObject(this.enemyObject
            , this.state).then(tempObject => {

            tempObject.model.position = offset;
            tempObject.hp = 100;
            tempObject.collidable = true;
            tempObject.onCollide = (object) => {
                if (object.name === "playerModel") {
                    if (object.hp !== undefined) {
                        object.hp -= 10;
                    }
                } else if (!(Object.keys(object).length === 0)) {
                    return;
                }

                let collArray = this.collidableObjects;
                let collIndex = collArray.indexOf(tempObject);
                if (collIndex > -1) { // only splice array when item is found
                    collArray.splice(collIndex, 1); // 2nd parameter means remove one item only
                }
                
                let enemyList = this.enemyList;
                let enemyIndex = enemyList.indexOf(tempObject);
                if (enemyIndex > -1) { // only splice array when item is found
                    enemyList.splice(enemyIndex, 1); // 2nd parameter means remove one item only
                }

                let array = state.objects;
                let arrayIndex = array.indexOf(tempObject);
                if (arrayIndex > -1) { // only splice array when item is found
                    state.objects.splice(arrayIndex, 1); // 2nd parameter means remove one item only
                }

                //console.log(`Enemy collided with ${object.name}!`);
            };

            this.createSphereCollider(tempObject, this.gamevars.enemyDefaultRadius,tempObject.onCollide);
            this.enemyList.push(tempObject); // add to spawned objects list
        });
    }

    spawnEnemyaroundCircle() {

        let random1 = -3.14 + Math.random() * 6.28
        this.spawnEnemy(vec3.add(vec3.create(), this.character.model.position, vec3.fromValues(15*Math.cos(random1), 0.5, 7*Math.sin(random1))));

    }

    //Move all enemies towards the player
    moveEnemies() {
        this.enemyList.forEach((object) => {
            let dirVector = vec3.create();
            vec3.subtract(dirVector, this.character.model.position, object.model.position);
            vec3.normalize(dirVector, dirVector);
            vec3.scale(dirVector, dirVector, 0.02);
            vec3.add(object.model.position, object.model.position, dirVector);

            this.checkCollision(object);
        });
    }

    removeDeadEnemies() {
        let array = this.enemyList;
        for (let i = array.length - 1; i >= 0; i--) {
            let hp = array[i].hp;
            if (!(hp > 0)) {

                // onCollide removes them from all the lists
                array[i].onCollide({});
            }
        }
    }

    // spawn light around health
    spawnLight(offset) {
        let light = {...this.lightConstructor}

        light.position = offset;
        light.name = `Health Pack Light${this.elapsedTime}`;
        light.colour = [ 0.2, 1.0, 0.2 ];
        light.position = offset;
        light.strength = 0.1;
        
        state.pointLights.push(light);
        state.numLights = state.pointLights.length;
        //console.log(state.pointLights);

        light.remove = async () => {
            //console.log(state.pointLights);

            let array = state.pointLights;
            let arrayIndex = array.indexOf(light);
            if (arrayIndex > -1) { // only splice array when item is found
                await state.pointLights.splice(arrayIndex, 1); // 2nd parameter means remove one item only
            };
        };

        return light;
    }
    
    spawnHealthonPlane() {

            let minmax = this.gamevars.minmax;
            //console.log(minmax);
            let minx = minmax.min[0];
            let maxx = minmax.max[0];
    
            let minz = minmax.min[2];
            let maxz = minmax.max[2];
            
            let random1 = minx + Math.random() * (maxx - minx);
            let random2 = minz + Math.random() * (maxz - minz);

            this.spawnHealth([random1, 1.1, random2]);

    }

    spawnHealth(offset) {
        let tempObject = spawnObject(this.enemyObject
            , this.state).then(tempObject => {

            tempObject.model.position = offset;
            tempObject.model.scale = [0.25, 0.3, 0.25];

            tempObject.material.ambient = [0.2, 0.8, 0.2];
            tempObject.material.diffuse = [0.2, 0.8, 0.2];
            tempObject.material.alpha = 0.1;


            tempObject.healthPack = true;
            tempObject.collidable = true;
            tempObject.light = this.spawnLight(offset);
            tempObject.name = "Health Pack"

            tempObject.onCollide = (object) => {
                if (object.name === "playerModel") {
                    if (object.hp !== undefined) {
                        object.hp += 20;
                    }
                } else if (!(Object.keys(object).length === 0)) {
                    return;
                }

                //console.log(tempObject);
                if (tempObject.light) {
                    //console.log(tempObject.light);
                    tempObject.light.remove();
                }

                let collArray = this.collidableObjects;
                let collIndex = collArray.indexOf(tempObject);
                if (collIndex > -1) { // only splice array when item is found
                    collArray.splice(collIndex, 1); // 2nd parameter means remove one item only
                }
                
                let spawnedObjects = this.spawnedObjects;
                let enemyIndex = spawnedObjects.indexOf(tempObject);
                if (enemyIndex > -1) { // only splice array when item is found
                    spawnedObjects.splice(enemyIndex, 1); // 2nd parameter means remove one item only
                }

                let array = state.objects;
                let arrayIndex = array.indexOf(tempObject);
                if (arrayIndex > -1) { // only splice array when item is found
                    state.objects.splice(arrayIndex, 1); // 2nd parameter means remove one item only
                }

                //console.log(`Enemy collided with ${object.name}!`);
            };

            this.createSphereCollider(tempObject, this.gamevars.enemyDefaultRadius,tempObject.onCollide);
            this.spawnedObjects.push(tempObject); // add to spawned objects list
        });
    }

    // https://www.desmos.com/calculator/fslhmsn3jn
    // starts at 2 and goes down to one every 1/10 after an hour.
    calculateSpawnInterval(totalTime) {
        return 3600 / (10 * (totalTime + 180));
    }

    interpolate(a, b, t) {
        return a + t * (b - a)
    }

    playerColorFromHealth() {

        // Red color for low health
        let LowHealth = [1.0, 0.0, 0.0]; // Red

        // Character's current health (normalized between 0 and 1)
        let ambientDefault = this.defaultPlayerColorAmbient;
        let diffuseDefault = this.defaultPlayerColorDiffuse;
        let hpNormalized = this.character.hp / 100;

        // Interpolate ambient and diffuse colors based on health
        this.character.material.ambient = [
            this.interpolate(LowHealth[0], ambientDefault[0], hpNormalized),
            this.interpolate(LowHealth[1], ambientDefault[1], hpNormalized),
            this.interpolate(LowHealth[2], ambientDefault[2], hpNormalized),
        ];
        
        this.character.material.diffuse = [
            this.interpolate(LowHealth[0], diffuseDefault[0], hpNormalized),
            this.interpolate(LowHealth[1], diffuseDefault[1], hpNormalized),
            this.interpolate(LowHealth[2], diffuseDefault[2], hpNormalized),
        ];
    }

    spawnLogic(currentSpawnInterval, elapsedTimeSinceSpawn, elapsedTimeSinceHealth, deltaTime) {

        if (elapsedTimeSinceSpawn >= currentSpawnInterval) {

            this.spawnEnemyaroundCircle()
            this.elapsedTimeSinceSpawn = 0.0;

        } else if (elapsedTimeSinceHealth >= 5.0) {

            this.spawnedObjects.forEach((object) => {
                if (object.healthPack === true) {
                    object.rotate('y', deltaTime * 0.5);
                }
            });

            if (this.spawnedObjects.length <= 4) {
                // spawn health pack.
                this.spawnHealthonPlane()
            }

            this.elapsedTimeSinceHealth = 0.0;

        }
    }

    // Runs once every frame non stop after the scene loads
    onUpdate(deltaTime) {
        // TODO - Here we can add game logic, like moving game objects, detecting collisions, you name it. Examples of functions can be found in sceneFunctions
        //Update the total time in the game and the elapsed time between spawns
        this.elapsedTimeSinceSpawn = this.elapsedTimeSinceSpawn + deltaTime;
        this.elapsedTimeSinceHealth = this.elapsedTimeSinceHealth + deltaTime;
        this.totalTime = this.totalTime + deltaTime;

        const currentSpawnInterval = this.calculateSpawnInterval(this.totalTime);

        this.spawnLogic(currentSpawnInterval, this.elapsedTimeSinceSpawn, this.elapsedTimeSinceHealth, deltaTime);
        

        this.playerColorFromHealth()
        // process our input. We'll have to keep in mind that we won't process input if the character is dead.
        this.processInput()

        // example: Rotate a single object we defined in our start method
        this.moveProjectiles(deltaTime);
        this.removeDeadEnemies();
        this.moveEnemies();

        // check collisions.
        this.checkCollision(this.character);
    }
}
