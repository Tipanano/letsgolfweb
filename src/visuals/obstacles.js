import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { OBSTACLE_TYPES } from '../obstacleConfig.js';

// Create a tree mesh
function createTreeMesh(props) {
  const group = new THREE.Group();

  // Trunk
  const trunkGeometry = new THREE.CylinderGeometry(
    props.trunkRadius,
    props.trunkRadius,
    props.trunkHeight,
    8
  );
  const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x4a3728 });
  const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
  trunk.position.y = props.trunkHeight / 2;
  group.add(trunk);

  // Foliage (cone shape)
  const foliageGeometry = new THREE.ConeGeometry(
    props.foliageRadius,
    props.height - props.trunkHeight,
    8
  );
  const foliageMaterial = new THREE.MeshLambertMaterial({ color: props.color });
  const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
  foliage.position.y = props.trunkHeight + (props.height - props.trunkHeight) / 2;
  group.add(foliage);

  return group;
}

// Create a bush mesh
function createBushMesh(props) {
  const geometry = new THREE.SphereGeometry(props.radius, 8, 6);
  const material = new THREE.MeshLambertMaterial({ color: props.color });
  const bush = new THREE.Mesh(geometry, material);
  bush.position.y = props.height / 2;
  bush.scale.y = props.height / (props.radius * 2); // Flatten slightly
  return bush;
}

// Create obstacle mesh based on type
export function createObstacleMesh(obstacle) {
  let mesh;

  if (obstacle.type === OBSTACLE_TYPES.TREE) {
    mesh = createTreeMesh(obstacle);
  } else if (obstacle.type === OBSTACLE_TYPES.BUSH) {
    mesh = createBushMesh(obstacle);
  } else {
    // Default to bush if unknown type
    mesh = createBushMesh(obstacle);
  }

  mesh.position.x = obstacle.x;
  mesh.position.z = obstacle.z;
  mesh.userData.obstacle = obstacle;

  return mesh;
}

// Render all obstacles for a course
export function renderObstacles(scene, obstacles) {
  const obstacleGroup = new THREE.Group();
  obstacleGroup.name = 'obstacles';

  obstacles.forEach(obstacle => {
    const mesh = createObstacleMesh(obstacle);
    obstacleGroup.add(mesh);
  });

  scene.add(obstacleGroup);
  return obstacleGroup;
}

// Clear obstacles from scene
export function clearObstacles(scene) {
  const obstacleGroup = scene.getObjectByName('obstacles');
  if (obstacleGroup) {
    obstacleGroup.children.forEach(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
      // Handle groups (trees with multiple meshes)
      if (child.children) {
        child.children.forEach(subChild => {
          if (subChild.geometry) subChild.geometry.dispose();
          if (subChild.material) subChild.material.dispose();
        });
      }
    });
    scene.remove(obstacleGroup);
  }
}
