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
        this.elapsedTime = 0.0;
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

    // example - we can add our own custom method to our game and call it using 'this.customMethod()'
    customMethod() {
        console.log("Custom method!");
    }

    eyeTraceToShootPlane(desiredY, screenX, screenY) {
        // not my work, forget where I found it from, gotta find that stack
        // overflow thread to give credit because when I tried to inverse
        // projectionmatrix I just kept getting NaN
        let proj = this.state.projectionMatrix;
        
        let viewMatrix = this.state.viewMatrix;
        let canvasX = this.state.canvas.width
        let canvasY = this.state.canvas.height

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

        //console.log(rayDirection[2], this.state.camera.position[2], desiredY);
        let t = (desiredY - this.state.camera.position[1]) / rayDirection[1];
        //console.log(t);

        let intersectionPoint = vec3.create();
        vec3.scaleAndAdd(intersectionPoint, this.state.camera.position, rayDirection, t);
        //console.log(intersectionPoint);

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
                console.log(`Collided with ${otherObject.name}`);
                if ((object.name === "playerModel") && (otherObject.name === "enemyModel")) {
                    //Impossible to figure out which enemy of the objects array is being collided with here, so we
                    //change the name and then address it later.
                    otherObject.name = "dead";
                }
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
                console.log(`Collided with ${otherObject.name}`);
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
            vec3.min(min, min, transformedVertex);
            vec3.max(max, max, transformedVertex);
        }

        //console.log(`${object.name} Min: `, min);
        //console.log(`${object.name}Max: `, max);

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

        //console.log(dist_squared);

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
        this.createSphereCollider(this.character, this.getSphereRadiusFromAABB(this.getOBBsMinMax(this.character)));
        this.character.collider.radius = 0.5 * this.character.collider.radius;

        this.surface = getObject(this.state, "surfacePlane");
        // make the plane follow the character then adjust its texture coordinates (this doesn't change any texture
        // coordinates yet it just parents the surface to the character)
        //this.surface.parent = this.character;
        //console.log("Parent: ", this.surface.parent);
        //vec3.subtract(this.surface.position, this.surface.position, vec3.fromValues(0.0,-10.0,0.0));
        //this.surface.translate(vec3.fromValues(0.0, -1.0, 0));

        this.frontWall = getObject(this.state, "frontWall");
        this.createOBBCollider(this.frontWall, this.getOBBsMinMax(this.frontWall));

        this.backWall = getObject(this.state, "backWall");
        this.createOBBCollider(this.backWall, this.getOBBsMinMax(this.backWall));

        this.leftWall = getObject(this.state, "leftWall");
        this.createOBBCollider(this.leftWall, this.getOBBsMinMax(this.leftWall));

        this.rightWall = getObject(this.state, "rightWall");
        this.createOBBCollider(this.rightWall, this.getOBBsMinMax(this.rightWall));

        this.enemyObject = getObject(this.state, "enemyModel");
        this.createSphereCollider(this.enemyObject, this.getSphereRadiusFromAABB(this.getOBBsMinMax(this.character)));


        console.log(state.objects);
        // LEAVE THIS COMMENT IN, WE'RE GOING TO NEED THIS LATER.
        // example - create sphere colliders on our two objects as an example, we give 2 objects colliders otherwise
        // no collision can happen
        // this.createSphereCollider(this.cube, 0.5, (otherObject) => {
        //     console.log(`This is a custom collision of ${otherObject.name}`)
        // });
        // this.createSphereCollider(otherCube, 0.5);

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
                console.log("left click pressed");
            } else if (e.button === 2) {
                mouse.right = true;
                console.log("right click pressed");
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

        
        this.customMethod(); // calling our custom method! (we could put spawning logic, collision logic etc in there ;) ) 

        // example: spawn some stuff before the scene starts
        // for (let i = 0; i < 10; i++) {
        //     for (let j = 0; j < 10; j++) {
        //         for (let k = 0; k < 10; k++) {
        //             spawnObject({
        //                 name: `new-Object${i}${j}${k}`,
        //                 type: "cube",
        //                 material: {
        //                     diffuse: randomVec3(0, 1)
        //                 },
        //                 position: vec3.fromValues(4 - i, 5 - j, 10 - k),
        //                 scale: vec3.fromValues(0.5, 0.5, 0.5)
        //             }, this.state);
        //         }
        //     }
        // }

        
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
        //console.log(attacking);

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

        let eyepos = vec3.create();
        vec3.transformMat4(eyepos, object.centroid, object.model.modelMatrix);

        //console.log("EYEPOS: ",eyepos);
        let desiredY = eyepos[1]
        let shootpos = this.eyeTraceToShootPlane(desiredY, mousePos.x, mousePos.y);

        let direction = vec3.create();
        vec3.subtract(direction, shootpos, eyepos);

        vec3.normalize(direction, direction);
        //console.log(direction);

        // Define character movement based on the key
        switch (mouseKey) {
            case 1:
                
                
                console.log("mouse1 down");
                this.spawnProjectile(eyepos, direction, 0.07)
                break;
            case 2:
                console.log("mouse2 down");
                // shoot a laser??
                
                break;
            
            case 3:
                console.log("mouse3 down");
                break;
            // Add other cases as needed
        }
    }

    // move the character. No more jagged teleporting.
    moveCharacter(key) {
        // Define character movement based on the key
        // fixed capslock issues, sorta.
        switch (key) {
            case "a":
            case "A":
                this.character.translate(vec3.fromValues(0.1, 0, 0));
                vec3.add(state.camera.position, state.camera.position, vec3.fromValues(0.1, 0.0,0.0));
                break;
            case "d":
            case "D":
                this.character.translate(vec3.fromValues(-0.1, 0, 0));
                 vec3.add(state.camera.position, state.camera.position, vec3.fromValues(-0.1, 0.0, 0.0));
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
    }

    //Move all enemies towards the player
    moveEnemies() {
        
        for (let i = 0; i < state.objects.length; i++) {
            if (state.objects[i].name === "enemyModel") {
                let dirVector = vec3.create();
                vec3.subtract(dirVector, this.character.model.position, state.objects[i].model.position);
                vec3.normalize(dirVector, dirVector);
                vec3.scale(dirVector, dirVector, 0.05);
                vec3.add(state.objects[i].model.position, state.objects[i].model.position, dirVector);
            }
        }
    }

    removeDeadEnemies() {
        let arrayLength = state.objects.length;
        for (let i = 0; i < arrayLength; i++) {
            if (state.objects[i].name === "dead") {
                //Remove the dead enemy from the objects list and reset i
                state.objects.splice(i, 1);
                i = 0;
                arrayLength -= 1;
            }
        }
    }

    moveEnemies() {
        
        for (let i = 0; i < state.objects.length; i++) {
            if (state.objects[i].name === "enemyModel") {
                let dirVector = vec3.create();
                vec3.subtract(dirVector, this.character.model.position, state.objects[i].model.position);
                vec3.normalize(dirVector, dirVector);
                vec3.scale(dirVector, dirVector, 0.05);
                vec3.add(state.objects[i].model.position, state.objects[i].model.position, dirVector);
            }
        }
    }

    spawnProjectile(origin, direction, speed) {

        let tempObject = spawnObject({
            name: `Projectile${this.elapsedTime}`,
            type: "cube",
            material: {
                diffuse: randomVec3(0, 1)
            },
            position: origin,
            scale: vec3.fromValues(0.5, 0.5, 0.5),
        }, this.state).then(tempObject => {
            //console.log(tempObject);
            let minmax = this.getOBBsMinMax(tempObject);

            //tempObject.direction = direction;
            //tempObject.speed = speed;

            tempObject.velocity = direction.map(a => a * speed)
            //direction: direction,
            //speed: speed,
            //let c = tempObject.centroid
            // move to center
            tempObject.translate(tempObject.centroid.map(element => element * -1));
            
            tempObject.collidable = true;
            tempObject.onCollide = (object) => {
                console.log(`I collided with ${object.name}!`);
            };

            this.createSphereCollider(tempObject, this.getSphereRadiusFromAABB(minmax),tempObject.onCollide);
            this.projectiles.push(tempObject); // add to spawned objects list
        });
    }
    
    
    // Runs once every frame non stop after the scene loads
    onUpdate(deltaTime) {
        // TODO - Here we can add game logic, like moving game objects, detecting collisions, you name it. Examples of functions can be found in sceneFunctions
        //Update the total time in the game and the elapsed time between spawns
        this.elapsedTime = this.elapsedTime + deltaTime;
        this.totalTime = this.totalTime + deltaTime;


        
        /*
        //If it's been two seconds since anything was spawned, run the loop to spawn enemies
        if (this.elapsedTime >= 2.0) {
            //The amount of enemies spawned every second increases every 20 seconds 
            let spawnRate = Math.floor(this.totalTime / 20) + 1;
            this.elapsedTime = 0.0;
            for (let i = 0; i < spawnRate; i++) {
                //the spawnObject function creates an object and automatically puts it into the state.objects list. This is helpful, but it also makes it
                //difficult to get it directly since it then sorts the list by depth, so we can't just grab the last object in the list.
                this.newEnemy = spawnObject(state.loadObjects[1], state);
                for (let j = 0; j < state.objects.length; j++) {
                    if ((this.state.objects[j].name === "enemyModel") && (this.state.objects[j].collider === undefined)) {
                        //If we find an enemy within the list that doesn't have a collider, it needs to be given a collider and then spawned a random direction from the player.
                        this.createSphereCollider(state.objects[j], this.getSphereRadiusFromAABB(this.getOBBsMinMax(state.objects[j])));
                        let randomOffset = randomVec3(0, 1);
                        //Convert the vec3 to a vec2 because we only need 2 dimensions in this case. Math.random doesn't give negative numbers, so I had to
                        // use 1 + Math.round(Math.random()) * 2 on each coordinate in order to multiply it by 1 or -1, so it spawns enemies randomly in all
                        //four quadrants.
                        randomOffset = vec2.fromValues(randomOffset[0] * (-1 + Math.round(Math.random()) * 2), randomOffset[2] * (-1 + Math.round(Math.random()) * 2));
                        vec2.normalize(randomOffset, randomOffset);
                        vec2.scale(randomOffset, randomOffset, 5);
                        vec3.add(state.objects[j].model.position, this.character.model.position, vec3.fromValues(randomOffset[0], 0, randomOffset[1]));
                        
                    }
                }
                //Create an enemy sphere and give it a collision box
            }
        }
        */

        

        // process our input. We'll have to keep in mind that we won't process input if the character is dead.
        this.processInput()

        // example: Rotate a single object we defined in our start method

        this.moveEnemies();
        
        // check collisions.
        this.checkCollision(this.character);

        this.removeDeadEnemies();

        //simulate a collision between the first spawned object and 'cube' 
        // put this in a helper function, ugly block in main bad
        this.projectiles.forEach((object) => {
            this.checkCollision(object);
            //console.log(object);
            object.translate(object.velocity);
        });

        

        // example - call our collision check method on our cube
        // this.checkCollision(this.cube);
    }
}
