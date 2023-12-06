class Plane extends RenderObject {
    constructor(glContext, object) {
        super(glContext, object);
        this.type = "plane";
        this.model = { ...this.model,
            vertices: [
                0.0, 0.5, 0.5,
                0.0, 0.5, 0.0,
                0.5, 0.5, 0.0,
                0.5, 0.5, 0.5,
            ],
            triangles: [
                0, 2, 1, 2, 0, 3,
            ],
            uvs: [
                0.0, 0.0,
                5.0, 0.0,
                5.0, 5.0,
                0.0, 5.0,
            ],
            normals: [
                0.0, 1.0, 0.0,
                0.0, 1.0, 0.0,
                0.0, 1.0, 0.0,
                0.0, 1.0, 0.0,
            ],
            bitangents: [
                0, -1, 0,
                0, -1, 0,
                0, -1, 0,
                0, -1, 0, // top
            ]
        };
    }

    setup() {
        this.centroid = calculateCentroid(this.model.vertices);
        this.lightingShader();
        this.scale(this.initialTransform.scale);
        this.translate(this.initialTransform.position);
        this.model.rotation = this.initialTransform.rotation;
        this.initBuffers();
    }
}
