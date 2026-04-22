import * as THREE from 'three';

// preserveDrawingBuffer is required for captureStream() so the WebGL
// back-buffer isn't cleared before MediaRecorder reads the frame.
export const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0); // transparent — composited over body background
document.body.appendChild(renderer.domElement);

export const scene  = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 7);

export const clock = new THREE.Clock();

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.5));

const keyLight = new THREE.DirectionalLight(0xfff8e8, 1.5);
keyLight.position.set(4, 8, 6);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x6070ff, 0.5);
rimLight.position.set(-5, -3, -4);
scene.add(rimLight);
