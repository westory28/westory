import * as THREE from "three";

const PRESETS = Object.freeze([
  { id: "idle", label: "기본" },
  { id: "wave", label: "안녕" },
  { id: "cheer", label: "응원" },
  { id: "think", label: "생각 중" },
  { id: "heart", label: "마음 모아" },
  { id: "tilt", label: "고개 갸웃" },
]);

/**
 * Static poses for a humanoid skeleton. It changes bones only: no model downloads,
 * animation loop, geometry replacement or network generation occurs per choice.
 * forwardAxis is the asset's front in root-local coordinates, before stage rotation.
 */
export function createPoseController(
  root,
  { forwardAxis = new THREE.Vector3(0, 0, 1), armsEnabled = false } = {},
) {
  const bones = new Map();
  const snapshots = [];
  const skinnedMeshes = [];
  root.traverse((object) => {
    if (object.isBone) {
      bones.set(object.name.toLowerCase().replace(/[^a-z0-9]/g, ""), object);
      snapshots.push({
        object,
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone(),
      });
    }
    if (object.isSkinnedMesh) skinnedMeshes.push(object);
  });
  const find = (...names) =>
    names
      .map((name) => bones.get(name.toLowerCase().replace(/[^a-z0-9]/g, "")))
      .find(Boolean);
  const head = find("Head", "mixamorigHead");
  const neck = find("neck", "mixamorigNeck");
  const spine = find("Spine", "mixamorigSpine2", "Chest");
  const chains = Object.fromEntries(
    ["Left", "Right"].map((side) => [
      side.toLowerCase(),
      {
        shoulder: find(
          side + "Arm",
          "mixamorig" + side + "Arm",
          side + "UpperArm",
        ),
        elbow: find(
          side + "ForeArm",
          "mixamorig" + side + "ForeArm",
          side + "LowerArm",
        ),
        hand: find(side + "Hand", "mixamorig" + side + "Hand"),
      },
    ]),
  );
  const hasArms =
    armsEnabled &&
    Object.values(chains).every(
      (chain) => chain.shoulder && chain.elbow && chain.hand,
    );
  const hasHead = !!(head || neck);
  const supported = Object.freeze(
    PRESETS.filter(
      (p) => p.id === "idle" || (p.id === "tilt" ? hasHead : hasArms),
    ).map((p) => p.id),
  );
  const labels = Object.freeze(
    Object.fromEntries(
      PRESETS.filter((p) => supported.includes(p.id)).map((p) => [
        p.id,
        p.label,
      ]),
    ),
  );
  const upLocal = new THREE.Vector3(0, 1, 0);
  const forwardLocal = forwardAxis.clone().setY(0).normalize();
  if (forwardLocal.lengthSq() < 0.5) forwardLocal.set(1, 0, 0);
  const rightLocal = new THREE.Vector3()
    .crossVectors(upLocal, forwardLocal)
    .normalize();
  let currentPose = "idle",
    disposed = false;

  function restore() {
    for (const { object, position, quaternion, scale } of snapshots) {
      object.position.copy(position);
      object.quaternion.copy(quaternion);
      object.scale.copy(scale);
    }
    root.updateMatrixWorld(true);
  }
  function axes() {
    const q = root.getWorldQuaternion(new THREE.Quaternion());
    return {
      up: upLocal.clone().applyQuaternion(q),
      forward: forwardLocal.clone().applyQuaternion(q),
      right: rightLocal.clone().applyQuaternion(q),
    };
  }
  function rotateWorld(bone, worldDelta) {
    if (!bone) return;
    const desired = worldDelta
      .clone()
      .multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    if (bone.parent)
      desired.premultiply(
        bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert(),
      );
    bone.quaternion.copy(desired).normalize();
    root.updateMatrixWorld(true);
  }
  function rotateAround(bone, axis, angle) {
    rotateWorld(bone, new THREE.Quaternion().setFromAxisAngle(axis, angle));
  }
  function point(bone) {
    return bone.getWorldPosition(new THREE.Vector3());
  }
  function aim(bone, child, target) {
    const origin = point(bone),
      before = point(child).sub(origin),
      after = target.clone().sub(origin);
    if (before.lengthSq() < 1e-10 || after.lengthSq() < 1e-10) return;
    rotateWorld(
      bone,
      new THREE.Quaternion().setFromUnitVectors(
        before.normalize(),
        after.normalize(),
      ),
    );
  }
  function arm(side, target, bendDirection) {
    const { shoulder, elbow, hand } = chains[side];
    const s = point(shoulder),
      e = point(elbow),
      h = point(hand);
    const upper = s.distanceTo(e),
      lower = e.distanceTo(h);
    const direction = target.clone().sub(s);
    const distance = THREE.MathUtils.clamp(
      direction.length(),
      Math.abs(upper - lower) + 1e-5,
      (upper + lower) * 0.985,
    );
    direction.normalize();
    const end = s.clone().addScaledVector(direction, distance);
    let bend = bendDirection
      .clone()
      .addScaledVector(direction, -bendDirection.dot(direction));
    if (bend.lengthSq() < 1e-8)
      bend = axes().forward.addScaledVector(
        direction,
        -axes().forward.dot(direction),
      );
    bend.normalize();
    const along =
      (upper * upper - lower * lower + distance * distance) / (2 * distance);
    const away = Math.sqrt(Math.max(0, upper * upper - along * along));
    const elbowTarget = s
      .clone()
      .addScaledVector(direction, along)
      .addScaledVector(bend, away);
    aim(shoulder, elbow, elbowTarget);
    aim(elbow, hand, end);
  }
  function reach(
    side,
    across,
    vertical,
    forward,
    bendAcross = 0.6,
    bendForward = 0.7,
    bendDown = 0.2,
  ) {
    const chain = chains[side],
      s = point(chain.shoulder);
    const span =
      s.distanceTo(point(chain.elbow)) +
      point(chain.elbow).distanceTo(point(chain.hand));
    const { right, up, forward: front } = axes(),
      sign = side === "left" ? 1 : -1;
    const target = s
      .clone()
      .addScaledVector(right, across * sign * span)
      .addScaledVector(up, vertical * span)
      .addScaledVector(front, forward * span);
    const bend = right
      .clone()
      .multiplyScalar(bendAcross * sign)
      .addScaledVector(front, bendForward)
      .addScaledVector(up, -bendDown);
    arm(side, target, bend);
  }
  function setPose(id) {
    if (id === "thinking") id = "think";
    if (disposed || !supported.includes(id)) return false;
    restore();
    const { right, forward, up } = axes();
    if (id === "idle" && hasArms) {
      // The source rig's A-pose is a bind pose, not the resting appearance.
      // Keep both hands beside the body with a soft, slightly asymmetric bend.
      reach("left", 0.13, -0.9, 0.08);
      reach("right", 0.12, -0.88, 0.12);
    } else if (id === "tilt") {
      rotateAround(neck || head, forward, -0.12);
      if (head && neck) rotateAround(head, forward, -0.08);
      rotateAround(head, up, 0.055);
    } else if (id === "wave") {
      reach("right", 0.1, 0.16, 0.35, 0.5, 0.05, 1.6);
      reach("left", 0.13, -0.9, 0.08);
      rotateAround(head, forward, 0.06);
    } else if (id === "cheer") {
      reach("right", 0.05, 0.18, 0.35, 0.5, 0.05, 1.6);
      reach("left", 0.05, 0.18, 0.35, 0.5, 0.05, 1.6);
      rotateAround(head, right, -0.04);
    } else if (id === "think") {
      reach("right", -0.12, 0.2, 0.55, 0.2, 0.8);
      reach("left", 0.12, -0.88, 0.12);
      rotateAround(head, forward, 0.07);
      rotateAround(head, right, 0.04);
    } else if (id === "heart") {
      reach("right", -0.28, -0.1, 0.55, 0.7, 0.8);
      reach("left", -0.28, -0.1, 0.55, 0.7, 0.8);
      rotateAround(head, right, 0.035);
    }
    root.updateMatrixWorld(true);
    // Pose changes invalidate the cached skin bounds used by culling/raycasting.
    for (const mesh of skinnedMeshes) {
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
    }
    currentPose = id;
    return true;
  }
  return {
    supported,
    labels,
    get currentPose() {
      return currentPose;
    },
    setPose,
    reset() {
      return setPose("idle");
    },
    dispose() {
      if (!disposed) {
        restore();
        disposed = true;
      }
    },
  };
}
