import { useEffect, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'

import { useXRStore } from '@react-three/xr'
import {
    CylinderGeometry, DynamicDrawUsage, Group, InstancedMesh,
    MeshBasicMaterial, Object3D, SphereGeometry, Vector3,
} from 'three'

const PINCH_START = 0.025
const PINCH_END = 0.04
const MIN_DISTANCE = 0.003
const RADIUS = 0.004
const BATCH_SIZE = 512
const UP = new Vector3(0, 1, 0)

type HandState = { ready: boolean; pinching: boolean; last: Vector3 | null }

// Shared geometry and batched instances keep drawing out of React's render loop.
class Drawing {
    group = new Group()
    hands = new Map<XRInputSource, HandState>()
    cylinder = new CylinderGeometry(1, 1, 1, 8)
    sphere = new SphereGeometry(1, 8, 6)
    material = new MeshBasicMaterial({ color: '#38e8ff' })
    segments: InstancedMesh[] = []
    dots: InstancedMesh[] = []
    transform = new Object3D()
    direction = new Vector3()
    index = new Vector3()
    thumb = new Vector3()
    point = new Vector3()

    addInstance(batches: InstancedMesh[], geometry: CylinderGeometry | SphereGeometry) {
        let mesh = batches.at(-1)
        if (!mesh || mesh.count === BATCH_SIZE) {
            mesh = new InstancedMesh(geometry, this.material, BATCH_SIZE)
            mesh.count = 0
            mesh.instanceMatrix.setUsage(DynamicDrawUsage)
            mesh.frustumCulled = false
            batches.push(mesh)
            this.group.add(mesh)
        }
        this.transform.updateMatrix()
        mesh.setMatrixAt(mesh.count++, this.transform.matrix)
        mesh.instanceMatrix.needsUpdate = true
    }

    sample(point: Vector3, hand: HandState) {
        const length = hand.last?.distanceTo(point) ?? 0
        if (hand.last && length < MIN_DISTANCE) return

        if (hand.last) {
            this.direction.subVectors(point, hand.last).normalize()
            this.transform.position.copy(hand.last).lerp(point, 0.5)
            this.transform.quaternion.setFromUnitVectors(UP, this.direction)
            this.transform.scale.set(RADIUS, length, RADIUS)
            this.addInstance(this.segments, this.cylinder)
        }
        this.transform.position.copy(point)
        this.transform.quaternion.identity()
        this.transform.scale.setScalar(RADIUS)
        this.addInstance(this.dots, this.sphere)
        if (hand.last) hand.last.copy(point)
        else hand.last = point.clone()
    }

    dispose() {
        for (const mesh of [...this.segments, ...this.dots]) mesh.dispose()
        this.cylinder.dispose()
        this.sphere.dispose()
        this.material.dispose()
        this.group.clear()
        this.hands.clear()
    }
}

export function HandDrawing({ grabbed }: { grabbed: RefObject<boolean> }) {
    const root = useRef<Group>(null)
    const drawing = useRef<Drawing | null>(null)
    const store = useXRStore()

    useEffect(() => {
        const current = new Drawing()
        const parent = root.current!
        drawing.current = current
        parent.add(current.group)
        return () => {
            parent.remove(current.group)
            current.dispose()
            drawing.current = null
        }
    }, [])

    useFrame((_, __, frame) => {
        const current = drawing.current
        if (!current) return
        const { origin, originReferenceSpace, session, visibilityState } = store.getState()
        if (grabbed.current || !frame?.getJointPose || !originReferenceSpace || !session || visibilityState !== 'visible') {
            current.hands.clear()
            return
        }
        origin?.updateWorldMatrix(true, false)
        for (const source of current.hands.keys()) {
            if (!Array.from(session.inputSources).includes(source)) current.hands.delete(source)
        }
        for (const source of session.inputSources) {
            const indexJoint = source.hand?.get('index-finger-tip')
            const thumbJoint = source.hand?.get('thumb-tip')
            if (!indexJoint || !thumbJoint) continue
            const indexPose = frame.getJointPose(indexJoint, originReferenceSpace)
            const thumbPose = frame.getJointPose(thumbJoint, originReferenceSpace)
            if (!indexPose || !thumbPose) {
                current.hands.delete(source)
                continue
            }
            let hand = current.hands.get(source)
            if (!hand) {
                hand = { ready: false, pinching: false, last: null }
                current.hands.set(source, hand)
            }
            current.index.copy(indexPose.transform.position)
            current.thumb.copy(thumbPose.transform.position)
            const distance = current.index.distanceTo(current.thumb)
            // Release the button's activation pinch before starting the first stroke.
            if (!hand.ready) {
                hand.ready = distance > PINCH_END
                continue
            }
            hand.pinching = distance < (hand.pinching ? PINCH_END : PINCH_START)
            if (!hand.pinching) {
                hand.last = null
                continue
            }
            current.point.copy(current.index).lerp(current.thumb, 0.5)
            // Joint poses are relative to XROrigin; ink remains fixed in world space.
            if (origin) current.point.applyMatrix4(origin.matrixWorld)
            current.sample(current.point, hand)
        }
    })

    return <group ref={root} pointerEvents="none" />
}


