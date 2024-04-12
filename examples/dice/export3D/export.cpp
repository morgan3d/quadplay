// Export raw 3D geometry in JSON format used by the dice example.
//
// Combines triangle mesh faces into polygon meshes, computes adjacency,
// and welds vertices.
//
// See https://casual-effects.com/g3d for the support library. Compile
// on Linux or macOS with icompile and on Windows using the G3D starter
// project template.
#include <G3D/G3D.h>

G3D_START_AT_MAIN();

class Face {
public:
    Array<int>         vertexIndex;
    Vector3            normal;
    // Was removed during remeshing
    bool               removed;

    Face() : removed(false) {}
};

class Edge {
public:
    int                vertexIndex[2];
    Vector3            normal;
    int                faceIndex[2];
};

static float tidy(const float x) {
    return abs(x) <= 7e-7 ? 0.0f : x;
}

static void writeXYZ(TextOutput& file, const Vector3& v) {
    file.printf("{\"x\": %g, \"y\": %g, \"z\":%g}", tidy(v.x), tidy(v.y), tidy(v.z));
}


static void remesh(Array<Face>& polyFaceArray, Array<Edge>& polyEdgeArray) {
    // 1. Find an edge between two faces that have the same normal
    // 2. Find iA = edge.vertexIndex[0] in faceA.vertexIndex
    // 3. Find iB = edge.vertexIndex[0] in faceB.vertexIndex
    // 4. Insert vertices of faceB starting with (iB + 1) into faceA after iA
    // 5. Update any edge referencing faceA to now reference faceA
    // 6. Remove faceB
    // 7. Remove the edge

    for (int e = 0; e < polyEdgeArray.size(); ++e) {
        const Edge& edge = polyEdgeArray[e];

        const int a = edge.faceIndex[0];
        const int b = edge.faceIndex[1];
        
        Face& faceA = polyFaceArray[a];
        Face& faceB = polyFaceArray[b];
            
        if (faceA.normal.dot(faceB.normal) > 0.99f) {
            
            // Find iA = edge.vertexIndex[0] in faceA.vertexIndex
            const int iA = faceA.vertexIndex.findIndex(edge.vertexIndex[0]);
            
            // Find iB = edge.vertexIndex[0] in faceB.vertexIndex
            const int iB = faceB.vertexIndex.findIndex(edge.vertexIndex[0]);
            
            debugAssertM(iA != -1 && iB != -1, "edge not in face");
            
            // Insert vertices of faceB starting with (iB + 1) into faceA after iA.
            // N-2 only vertices are needed, because two are shared
            for (int i = 1; i < faceB.vertexIndex.size() - 1; ++i) {
                faceA.vertexIndex.insert(iA + i, faceB.vertexIndex[(i + iB) % faceB.vertexIndex.size()]);
            }

            // Remove face B, updating any edges that it has to refer to face A
            faceB.removed = true;
            for (int i = 0; i < polyEdgeArray.size(); ++i) {
                for (int j = 0; j < 2; ++j) {
                    if (polyEdgeArray[i].faceIndex[j] == b) {
                        polyEdgeArray[i].faceIndex[j] = a;
                    }
                }
            }
                    
            // Remove the edge
            polyEdgeArray.fastRemove(e);
            --e;

        }
    } // for e

    // Compact the face array, updating indexing
    Array<int> oldToNew;
    for (int f = 0; f < polyFaceArray.size(); ++f) {
        if (polyFaceArray[f].removed) {
            // Remove from the array
            polyFaceArray.remove(f);
            --f;
            oldToNew.push(-1);
        } else {
            oldToNew.push(f);
        }
    }

    // Update the face indices
    for (int e = 0; e < polyEdgeArray.size(); ++e) {
        Edge& edge = polyEdgeArray[e];
        for (int i = 0; i < 2; ++i) {
            edge.faceIndex[i] = oldToNew[edge.faceIndex[i]];
            debugAssertM(edge.faceIndex[i] != -1, "Unmapped face index");
        }
    }
}


static void exportGeometry(const String& sourcePath) {
    Array<shared_ptr<Surface>> surfaceArray;

    const shared_ptr<ArticulatedModel>& model = ArticulatedModel::fromFile(sourcePath);
    const ArticulatedModel::Pose pose;
    
    model->pose(surfaceArray, Point3::zero(), Point3::zero(), nullptr, &pose, &pose, Surface::ExpressiveLightScatteringProperties());
   
    // Extract indexed triangle array
    CPUVertexArray packedVertexArray;
    Array<Tri> triArray;
    Surface::getTris(surfaceArray, packedVertexArray, triArray);

    Array<int> indexArray;
    for (const Tri& tri : triArray) {
        for (int i = 0; i < 3; ++i) {
            indexArray.push(tri.getIndex(i));
        }
    }

    Array<Point3> positionArray;

    // Weld into a single set of faces, ignoring normals and texcoords, for raw geo
    {
        Array<Point3> rawPositionArray;
        for (const CPUVertexArray::Vertex& vertex : packedVertexArray.vertex) {
            rawPositionArray.push(vertex.position);
        }
        
        // Weld
        Array<int> toNew;
        Array<int> toOld;
        MeshAlg::computeWeld(rawPositionArray, positionArray, toNew, toOld);
        
        // Map index array to post-weld scheme
        for (int i = 0; i < indexArray.size(); ++i) {
            indexArray[i] = toNew[indexArray[i]];
        }
    }

    // Compute adjacency
    Array<MeshAlg::Face> faceArray;
    Array<MeshAlg::Edge> edgeArray;
    Array<MeshAlg::Vertex> vertexArray;
    MeshAlg::computeAdjacency(positionArray, indexArray, faceArray, edgeArray, vertexArray);

    Array<Vector3> faceNormalArray;
    MeshAlg::computeFaceNormals(positionArray, faceArray, faceNormalArray);

    ///////////////////////////////////////////////////////////////
    // Convert to trivial triangle polymesh
    Array<Face>    polyFaceArray;
    Array<Edge>    polyEdgeArray;
    for (int f = 0; f < faceArray.size(); ++f) {
        const MeshAlg::Face& face = faceArray[f];
        
        Face& poly = polyFaceArray.next();

        poly.vertexIndex.resize(3);
        for (int i = 0; i < 3; ++i) {
            poly.vertexIndex[i] = face.vertexIndex[i];
        }

        poly.normal = faceNormalArray[f];
    }

    for (int e = 0; e < edgeArray.size(); ++e) {
        const MeshAlg::Edge& edge = edgeArray[e];
        Edge& polyEdge = polyEdgeArray.next();

        for (int i = 0; i < 2; ++i) {
            polyEdge.vertexIndex[i] = edge.vertexIndex[i];
            polyEdge.faceIndex[i] = edge.faceIndex[i];            
        }
        const Vector3& n0 = (edge.faceIndex[0] != MeshAlg::Face::NONE) ? faceNormalArray[edge.faceIndex[0]] : Vector3::zero();
        const Vector3& n1 = (edge.faceIndex[1] != MeshAlg::Face::NONE) ? faceNormalArray[edge.faceIndex[1]] : Vector3::zero();
        polyEdge.normal = (n0 + n1).directionOrZero();
    }
    

    // Remesh triangle mesh into polygon mesh
    remesh(polyFaceArray, polyEdgeArray);

    
    const String& filename = FilePath::base(sourcePath) + ".json";
    TextOutput file(filename);
    file.printf("{");
    file.writeNewline();
    file.pushIndent();
    {
        file.writeSymbols("\"vertex_array\":", "[");
        file.writeNewline();
        file.pushIndent();
        for (int p = 0; p < positionArray.size(); ++p) {
            const Point3& position = positionArray[p];
            writeXYZ(file, position);

            if (p < positionArray.size() - 1) {
                file.printf(",");
            }
            file.writeNewline();
        }
        file.popIndent();
        file.writeSymbols("],");
        file.writeNewline();
        
        file.writeSymbols("\"face_array\":", "[");
        file.writeNewline();
        file.pushIndent();
        for (int f = 0; f < polyFaceArray.size(); ++f) {
            const Face& face = polyFaceArray[f];
            file.writeSymbol("{");
            file.writeNewline();
            file.pushIndent();
            file.writeSymbols("\"index_array\":");
            file.printf("[");
            for (int i = 0; i < face.vertexIndex.size(); ++i) {
                file.printf("%d", face.vertexIndex[i]);
                if (i < face.vertexIndex.size() - 1) {
                    file.printf(", ");
                } else {
                    file.printf("],");
                }
            }
            file.writeNewline();
            
            file.writeSymbols("\"normal\":");
            writeXYZ(file, face.normal);
            file.writeNewline();
            file.popIndent();
            file.printf("}");
            if (f < faceArray.size() - 1) {
                file.printf(",");
            }
            file.writeNewline();
        }
        file.popIndent();
        file.writeSymbols("],");
        file.writeNewline();
        
        file.writeSymbols("\"edge_array\":", "[");
        file.writeNewline();
        file.pushIndent();
        for (int e = 0; e < polyEdgeArray.size(); ++e) {
            const Edge& edge = polyEdgeArray[e];
            file.writeSymbols("{");
            
            file.writeNewline();
            file.pushIndent();
            file.writeSymbols("\"index_array\":");
            file.printf("[%d, %d],", edge.vertexIndex[0], edge.vertexIndex[1]);
            file.writeNewline();
            file.writeSymbols("\"face_index_array\":");
            file.printf("[%d, %d],", edge.faceIndex[0], edge.faceIndex[1]);
            file.writeNewline();
            file.writeSymbols("\"normal\":");
            writeXYZ(file, edge.normal);
            
            file.writeNewline();
            file.popIndent();
            file.printf("}");
            if (e < edgeArray.size() - 1) {
                file.printf(",");
            }
            file.writeNewline();
        }
        file.popIndent();
        file.writeSymbols("]");
        file.writeNewline();
    }
    file.popIndent();
    file.writeSymbol("}");
    file.writeNewline();
    file.commit();

    debugPrintf("Saved %s\n", FilePath::concat(FileSystem::currentDirectory(), filename).c_str());
}


int main(int argc, char** argv) {
    GApp app;

    exportGeometry(System::findDataFile("d12.ifs"));
}
