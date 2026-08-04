import { encode, decode } from "@msgpack/msgpack";

/// The extension a shipped animation file carries, matching the Swift runtime's
/// `InertiaCoding.fileExtension`. An animation is MessagePack on disk and on the
/// wire alike — see `websocket-protocol.md`.
export const inertiaFileExtension = "inertia";

export interface InertiaAnimationSchema {
    id: string;
    initialValues: InertiaAnimationValues;
    invokeType: InertiaAnimationInvokeType;
    keyframes: Array<InertiaAnimationKeyframe>;
    /// What the actionable's canvas draws behind it. Optional to author, so an
    /// animation recorded before shapes existed — or one that simply wants none
    /// — still loads.
    shapes?: Array<InertiaShape>;
    /// How long one loop of the timeline this was authored on lasts.
    ///
    /// A property of the animation rather than of the editor that recorded it:
    /// a track is padded out to the loop, so an animation played back at a
    /// length other than the one it was drawn against holds — or truncates —
    /// where its author did not mean it to. Every schema in a project carries
    /// the same value, which is what the editor's one timeline slider writes.
    ///
    /// Optional to author, so an animation recorded before the loop was part of
    /// the schema — or one happy with the default — still loads.
    loopDuration?: number;
}

/// The loop `schemas` were authored against, or null if none of them say.
///
/// The longest, where a hand-edited file disagrees with itself: the loop is
/// what every track is padded out to, and the shorter answer would cut the
/// track that asked for more off at the knees.
export function authoredLoopDuration(
    schemas: Iterable<InertiaAnimationSchema>
): number | null {
    let authored: number | null = null;

    for (const schema of schemas) {
        if (schema.loopDuration === undefined) {
            continue;
        }
        const clamped = InertiaPlayback.clampLoopDuration(schema.loopDuration);
        authored = authored === null ? clamped : Math.max(authored, clamped);
    }

    return authored;
}

export type InertiaPoint = {
    x: number;
    y: number;
}

export type InertiaColor = {
    red: number;
    green: number;
    blue: number;
    alpha: number;
}

/// A single corner of a shape: where it sits, and what colour the shape is
/// there.
export type Vertex = {
    position: InertiaPoint;
    color: InertiaColor;
}

/// The kinds of vector a shape can be described as, rather than spelled out
/// corner by corner. A bare string on the wire, like every other enum here.
export enum InertiaShapeType {
    rectangle = "rectangle",
    square = "square",
    circle = "circle",
    oval = "oval",
    triangle = "triangle"
}

/// A drawn vector as the editor records it: what it is, how big, and how it is
/// painted — the size in the same multiples of the actionable its corners would
/// have been measured in.
///
/// Painting is the two halves a vector has always had everywhere else: `fill`
/// floods the area the outline encloses, `stroke` draws the outline itself, and
/// either may be left out. A shape with no fill is an outline on nothing; a
/// shape with no stroke is the flat area a described vector used to be; a shape
/// with neither draws nothing at all, which is the one combination there is no
/// reason to author.
export type InertiaShapeProperties = {
    id: string;
    type: InertiaShapeType;
    width: number;
    height: number;

    /// The colour flooding the outline, or absent for a shape that is only its
    /// outline.
    fill?: InertiaColor;

    /// The colour of the outline itself, or absent for a shape that is only its
    /// area. Draws nothing without a `strokeWidth` to draw it at.
    stroke?: InertiaColor;

    /// How thick the outline is, in the units the shape is sized in — multiples
    /// of the actionable's shorter side, the same as `width` and `height`, so a
    /// stroke keeps its weight relative to the shape at every size that frame
    /// takes, and is the same weight across as it is down.
    ///
    /// The stroke is drawn *inside* the outline: a shape occupies exactly the
    /// box it was authored at whether or not it is stroked, so adding a stroke
    /// never moves the shape or grows the canvas it is drawn on. A width past
    /// half the shape's smaller side would turn the ring inside out, so it is
    /// held there — a stroke that thick is a solid shape, and is drawn as one.
    strokeWidth?: number;
}

/// A shape as it is authored alongside an animation: a ring of corners, each
/// carrying its own colour, measured against the actionable it belongs to — the
/// origin its outline is drawn about, and 1 that view's shorter side.
///
/// One side rather than each of them, so a shape is drawn in a square space and
/// keeps the proportions it was described with: a circle of size 1 is round on a
/// view of any shape, and only a rectangle or an oval — the two descriptions
/// that say both of their measurements — is drawn wider than it is tall.
///
/// Nothing holds a shape to that box, though. Coordinates past that side reach
/// beyond the actionable and go on being drawn, because the canvas is fitted to
/// the shapes rather than to the view: a shape three times the size of the card
/// it backs is authored simply by saying 3.
///
/// A shape is authored one of two ways — `vertices`, corner by corner, or
/// `shape`, a vector described and drawn from that description — and may carry
/// an `animation` of its own, which is what makes it a drawing rather than a
/// backdrop: the corners say what is drawn, the track says how it moves, and
/// the actionable it was authored against carries both.
export type InertiaShape = {
    /// What this shape is, to anything that has to point at it: the editor's
    /// hierarchy panel, the selection sent back to the runtime, and the edit
    /// that selection authors.
    ///
    /// A shape used to be addressable only by where it sat — whose schema held
    /// it, and how far down the list — which is a name that changes when the
    /// shape either side of it is deleted. This does not.
    id: string;
    vertices?: Array<Vertex>;
    shape?: InertiaShapeProperties;
    animation?: InertiaAnimationSchema;
    /// Whether this shape is drawn on a canvas of its own rather than sharing
    /// one with the shapes beside it.
    ///
    /// A canvas is otherwise earned: a track needs one, because a shape that
    /// moves independently cannot share a vertex buffer with shapes that do not,
    /// and so does a selection, because the border and handles are fitted to one
    /// shape's box. This is that decision made up front instead — what to reach
    /// for when a track is coming later, or when a shape has to stay a layer of
    /// its own. Absent is a shape that shares, which is what every shape
    /// authored before this asked for one did.
    ownCanvas?: boolean;
    /// Where this shape sits inside whatever holds it: the actionable whose
    /// canvas it is drawn on, or — for a nested shape — the shape it is drawn
    /// inside of.
    ///
    /// A shape's corners are drawn about the origin of the box that holds it, so
    /// every described vector was authored dead centre of its parent and there
    /// was no way to say otherwise. This is that placement said outright, in the
    /// same five properties a track interpolates. The translation is a fraction
    /// of the parent's own box, the way every other measurement on a shape is.
    ///
    /// Placement rather than animation: it is baked into the corners the
    /// renderer is handed — which is what lets a *nested* shape be placed at all,
    /// since a child is drawn into its parent's vertex buffer and has no canvas
    /// of its own to transform — and a track the shape carries plays on top of
    /// it. Absent is the identity, which is where every shape authored before
    /// this was drawn.
    transforms?: InertiaAnimationValues;
    /// The shapes drawn inside this one, in the units of *its* box — 1 is this
    /// shape's shorter side, the way 1 is the view's shorter side one level up.
    ///
    /// A child is part of its parent's drawing rather than a drawing of its own:
    /// it is drawn on the parent's canvas, and every transform that moves the
    /// parent moves it too. Absent from a project authored before nesting, which
    /// reads unchanged.
    shapes?: Array<InertiaShape>;
}

export type InertiaRect = {
    x: number;
    y: number;
    width: number;
    height: number;
}

export type AnimationContainer = {
    actionableId: string;
    containerId: string;
}

export type InertiaCanvasSize = {
    width: number;
    height: number;
}

export enum MessageType {
    actionable = "actionable",
    actionables = "actionables",
    schema = "schema",
    translationEnded = "translationEnded",
    selectedNodeProperties = "selectedNodeProperties",
    signal = "signal",
    playbackProgress = "playbackProgress",
    tool = "tool",
    edit = "edit",
    nodeMeasured = "nodeMeasured"
}

/// What a drag in the runtime's viewport edits.
///
/// Picked in the editor's toolbar and sent here, because the gesture happens in
/// the app being authored rather than in the editor. One case per property of
/// `InertiaAnimationValues` — the same five the timeline breaks a track into.
export enum InertiaTool {
    translate = "translate",
    rotate = "rotate",
    rotateCenter = "rotateCenter",
    opacity = "opacity",
    scale = "scale"
}

/// One frame. `payload` is the inner message as a *separately encoded*
/// MessagePack document, carried in a `bin` value — which is what the Swift
/// runtime's `Data` payload is, and why nothing base64s anything any more.
export interface MessageWrapper {
    type: MessageType;
    payload: Uint8Array;
}

export type InertiaAnimationValues = {
    scale: number;
    translate: [number, number];
    rotate: number;
    rotateCenter: number;
    opacity: number;
}

/// Matches the Swift/Kotlin runtimes, which encode this as a bare string in the
/// project's animation JSON — a numeric enum could never round-trip that.
export enum InertiaAnimationInvokeType {
    trigger = "trigger",
    auto = "auto"
}

export type InertiaAnimationKeyframe = {
    id: string;
    values: InertiaAnimationValues;
    duration: number;
}

export type InertiaAnimationState = {
    id: string;
    trigger: boolean | null;
    isCancelled: boolean;
}

export class InertiaDataModel {
    public containerId: string;
    public inertiaSchemas: Map<string, InertiaAnimationSchema>;
    public tree: Tree;
    public actionableIdPairs: Set<ActionableIdPair>;
    public states: Map<string, InertiaAnimationState>;
    public actionableIdToAnimationIdMap: Map<string, string>;
    public isActionable: boolean = false
    /// Which property a gesture on a selected node edits, as picked in the
    /// editor's toolbar. `translate` until the editor says otherwise, which is
    /// also what a runtime that reconnects mid-session falls back to until the
    /// editor resends.
    public activeTool: InertiaTool = InertiaTool.translate

    constructor(containerId: string, inertiaSchemas: Map<string, InertiaAnimationSchema>, tree: Tree, actionableIdPairs: Set<ActionableIdPair>) {
        this.containerId = containerId;
        this.inertiaSchemas = inertiaSchemas;
        this.tree = tree;
        this.actionableIdPairs = actionableIdPairs;
        this.states = new Map<string, InertiaAnimationState>();
        this.actionableIdToAnimationIdMap = new Map<string, string>();
    }
}

export type InertiaID = string;

export type ActionableIdPair = {
    hierarchyIdPrefix: string;
    hierarchyId: string;
}

export class Node {
    public id: string;
    public parent?: Node;
    public children: Node[] = [];
    public parentId?: string;
    public tree?: Tree;

    constructor(id: string, parentId?: string) {
        this.id = id;
        this.parentId = parentId;
    }

    addChild(child: Node) {
        child.parent = this;
        child.parentId = this.id;
        this.children.push(child);
    }

    link() {
        if (this.parentId && this.tree) {
            this.parent = this.tree.nodeMap.get(this.parentId);
        }
        this.children.forEach(child => child.link());
    }

    // Encode to plain object for JSON serialization
    toJSON(): any {
        return {
            id: this.id,
            parentId: this.parentId,
            children: this.children.map(child => child.toJSON())
        };
    }

    // Decode from plain object
    static fromJSON(json: any, tree?: Tree): Node {
        const node = new Node(json.id, json.parentId);
        node.tree = tree;
        node.children = (json.children ?? []).map((c: any) => Node.fromJSON(c, tree));
        return node;
    }

    equals(other: Node): boolean {
        return this.id === other.id;
    }

    toString(): string {
        return `{id: ${this.id}, parentId: ${this.parentId}, children: [${this.children.map(c => c.id).join(", ")}]}`;
    }
}

export class Tree {
    public id: string;
    public rootNode?: Node;
    public nodeMap: Map<string, Node> = new Map();

    constructor(id: string) {
        this.id = id;

        this.addRelationship = this.addRelationship.bind(this)
    }

    addRelationship(id: string, parentId?: string, parentIsContainer: boolean = false) {
        // Get or create current node
        let currentNode = this.nodeMap.get(id);
        if (!currentNode) {
            currentNode = new Node(id, parentId);
            currentNode.tree = this;
            this.nodeMap.set(id, currentNode);
        }

        if (parentId) {
            let parentNode = this.nodeMap.get(parentId);
            if (!parentNode) {
                parentNode = new Node(parentId);
                parentNode.tree = this;
                this.nodeMap.set(parentId, parentNode);
            }

            parentNode.addChild(currentNode);

            if (parentIsContainer || (!this.rootNode && !parentNode.parent)) {
                this.rootNode = parentNode;
            }
        }
    }

    // Encode to plain object for JSON serialization
    toJSON(): any {
        return {
            id: this.id,
            nodeMap: Object.fromEntries(
                Array.from(this.nodeMap.entries()).map(([k, v]) => [k, v.toJSON()])
            ),
            rootNode: this.rootNode?.toJSON()
        };
    }

    // Decode from plain object
    static fromJSON(json: any): Tree {
        const tree = new Tree(json.id);

        // Reconstruct nodes
        for (const [key, nodeJson] of Object.entries(json.nodeMap ?? {})) {
            const node = Node.fromJSON(nodeJson, tree);
            tree.nodeMap.set(key, node);
        }

        if (json.rootNode) {
            tree.rootNode = Node.fromJSON(json.rootNode, tree);
        }

        // Link parent references
        tree.nodeMap.forEach(node => node.link());

        return tree;
    }

    equals(other: Tree): boolean {
        return this.rootNode?.equals(other.rootNode ?? new Node("")) ?? false;
    }

    toString(): string {
        return `treeId: ${this.id}, root: ${this.rootNode}`;
    }
}

export type InertiaSchemaWrapper = {
    schema: InertiaAnimationSchema;
    actionableId: string;
    container: AnimationContainer;
    animationId: string;
};

export interface MessageActionables {
    tree: Tree;
    actionableIds: Array<ActionableIdPair>;
}

export interface MessageActionable {
    isActionable: boolean;
}

export interface MessageSchema {
    schemaWrappers: InertiaSchemaWrapper[];
}

export type MessageTranslation = {
    translationX: number;
    translationY: number;
    actionableIds: Array<ActionableIdPair>;
}

export type MessageSelectedNodeProperties = {
    positionX: number;
    positionY: number;
    sizeX: number;
    sizeY: number;
    /// What the selection would be authored at if the gesture ended now. Absent
    /// from a runtime that only knows how to move a node, which is why the
    /// editor decodes it as optional.
    values?: InertiaAnimationValues;
}

/// Runtime → editor: the box an actionable was laid out in, in CSS pixels.
///
/// A shape is authored in multiples of the element it is drawn behind — 1 is
/// that element's shorter side — so the drawing alone never says how big it is.
/// Only the app knows: layout is what decides it, and it decides it again at
/// every size the app is run at. This is that measurement, sent as it is taken,
/// so the editor can draw a shape at the size it is really drawn at without a
/// view of the app to measure it in.
///
/// Carries the whole pair, not just the size: the id says which shapes it
/// measures, and the prefix is the schema they are authored on — which is what
/// the editor keys a shape by, since every instance of an actionable draws the
/// same ones.
export type MessageNodeMeasured = {
    hierarchyIdPrefix: string;
    hierarchyId: string;
    sizeX: number;
    sizeY: number;
}

/// Editor → runtime: which tool a gesture on a selected node applies.
export type MessageTool = {
    tool: InertiaTool;
}

/// Runtime → editor: where a gesture left the selection.
///
/// The whole transform rather than the one property the tool changed, because
/// that is what the editor records — a keyframe holds all five values, and the
/// four the tool did not touch still have to be the ones the node is sitting at.
///
/// Generalizes `MessageTranslation`, which this runtime no longer sends.
export type MessageEdit = {
    tool: InertiaTool;
    values: InertiaAnimationValues;
    actionableIds: Array<ActionableIdPair>;
}

/// What the editor's gestures have added on top of the values an actionable's
/// schema puts it at.
///
/// A delta rather than an absolute transform: the schema is what an actionable
/// *is* at, and the editor folds a gesture into it and pushes it back, at which
/// point this returns to `noToolEdit`. Holding it separately is what lets the
/// two be told apart, so the same move is never counted twice.
export type InertiaToolEdit = {
    /// Pixels in the container's coordinate space, which is what the drag is
    /// measured in. Normalized against the container only on the way out.
    translate: [number, number];
    /// Degrees, about the node's top-left corner.
    rotate: number;
    /// Degrees, about the node's center.
    rotateCenter: number;
    /// Added to the schema's scale rather than multiplying it, so scale
    /// accumulates across gestures exactly like every other property here.
    scale: number;
    opacity: number;
}

export const noToolEdit: InertiaToolEdit = {
    translate: [0, 0],
    rotate: 0,
    rotateCenter: 0,
    scale: 0,
    opacity: 0,
};

/// A node scaled to nothing has no box left to grab, and a negative scale
/// mirrors it. The smallest scale a handle will author.
export const minimumToolScale = 0.01;

export function isNoToolEdit(edit: InertiaToolEdit | null | undefined): boolean {
    if (!edit) return true;
    return edit.translate[0] === 0
        && edit.translate[1] === 0
        && edit.rotate === 0
        && edit.rotateCenter === 0
        && edit.scale === 0
        && edit.opacity === 0;
}

export function addToolEdits(lhs: InertiaToolEdit, rhs: InertiaToolEdit): InertiaToolEdit {
    return {
        translate: [lhs.translate[0] + rhs.translate[0], lhs.translate[1] + rhs.translate[1]],
        rotate: lhs.rotate + rhs.rotate,
        rotateCenter: lhs.rotateCenter + rhs.rotateCenter,
        scale: lhs.scale + rhs.scale,
        opacity: lhs.opacity + rhs.opacity,
    };
}

/// `values` with an in-progress edit folded into it — what the node is drawn at
/// while a handle is being dragged, and what the editor is told once it is let
/// go.
///
/// Scale and opacity are clamped rather than left to run: a scale through zero
/// flips the node inside out and a negative opacity is not a thing a keyframe
/// can hold.
export function applyToolEdit(
    values: InertiaAnimationValues,
    edit: InertiaToolEdit | null | undefined,
    canvasSize: InertiaCanvasSize
): InertiaAnimationValues {
    if (isNoToolEdit(edit) || !edit) return values;

    const width = canvasSize.width > 0 ? canvasSize.width : 1;
    const height = canvasSize.height > 0 ? canvasSize.height : 1;

    return {
        scale: Math.max(minimumToolScale, values.scale + edit.scale),
        translate: [
            values.translate[0] + edit.translate[0] / width,
            values.translate[1] + edit.translate[1] / height,
        ],
        rotate: values.rotate + edit.rotate,
        rotateCenter: values.rotateCenter + edit.rotateCenter,
        opacity: Math.min(1, Math.max(0, values.opacity + edit.opacity)),
    };
}

/// Where the run currently on screen has got to, reported while animating so
/// the editor's playhead can follow it. Mirrors `InertiaMessage.MessagePlaybackProgress`.
export type MessagePlaybackProgress = {
    /// Seconds since the run started, wrapped at `duration`.
    time: number;
    /// One turn of the timeline — the longest track, or the loop, whichever is longer.
    duration: number;
    /// False on the last message of a run: it finished or was paused.
    isRunning: boolean;
    /// The `sequence` of the last signal applied when this report was produced,
    /// so the editor can tell a report caused by its own request from one still
    /// in flight from before it.
    lastProcessedSequence: number;
}

/// The editor's transport commands. Swift synthesizes `Codable` for an enum
/// with associated values as a single-key map — `{"seek": {"_0": 1.25}}` —
/// which is what `decodeAnimationSignal` unpacks. MessagePack carries that map
/// as-is, so the shape is the same one the JSON wire had.
export type AnimationSignal =
    | { type: "pause" }
    | { type: "resume" }
    | { type: "seek"; time: number }
    | { type: "setLoopDuration"; duration: number };

export type MessageSignal = {
    signal: AnimationSignal;
    sequence: number;
}

export function decodeAnimationSignal(raw: any): AnimationSignal | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }

    if ("pause" in raw) return { type: "pause" };
    if ("resume" in raw) return { type: "resume" };

    if ("seek" in raw) {
        const time = Number(raw.seek?._0);
        return Number.isFinite(time) ? { type: "seek", time } : null;
    }

    if ("setLoopDuration" in raw) {
        const duration = Number(raw.setLoopDuration?._0);
        return Number.isFinite(duration) ? { type: "setLoopDuration", duration } : null;
    }

    return null;
}

export const InertiaPlayback = {
    /// How long one loop lasts until the editor says otherwise. A loop lasts as
    /// long as the timeline the animation was authored on, not as long as its
    /// last keyframe: every track is padded to it, so actionables of different
    /// lengths restart together and the editor's playhead stays with them.
    defaultLoopDuration: 3.0,
    /// The range the timeline can be resized to. Shorter than this can't hold a
    /// keyframe apart from its neighbours; longer is past being able to see the
    /// whole thing at once.
    loopDurationRange: { lowerBound: 0.1, upperBound: 60.0 },

    /// Brings a loop length the user typed, or a peer sent, into range.
    clampLoopDuration(seconds: number): number {
        if (!Number.isFinite(seconds)) {
            return InertiaPlayback.defaultLoopDuration;
        }
        const { lowerBound, upperBound } = InertiaPlayback.loopDurationRange;
        return Math.min(Math.max(seconds, lowerBound), upperBound);
    }
} as const;

/// Draws a thing exactly where it was laid out: what something with no
/// animation of its own is shown at, and the baseline an editor gesture on an
/// actionable that has no schema yet is measured from.
export const identityValues: InertiaAnimationValues = {
    scale: 1,
    translate: [0, 0],
    rotate: 0,
    rotateCenter: 0,
    opacity: 1
};

function valuesAreFinite(values: InertiaAnimationValues | undefined): boolean {
    return !!values
        && Number.isFinite(values.scale)
        && Number.isFinite(values.translate?.[0])
        && Number.isFinite(values.translate?.[1])
        && Number.isFinite(values.rotate)
        && Number.isFinite(values.rotateCenter)
        && Number.isFinite(values.opacity);
}

/// Falls back to the identity transform, so a NaN that slipped into a schema
/// can't reach the element's style and blank it out.
export function sanitizeValues(values: InertiaAnimationValues | undefined): InertiaAnimationValues {
    return valuesAreFinite(values) ? values! : identityValues;
}

/// The keyframes that can actually be interpolated. A zero-length keyframe —
/// which the editor records for two keyframes captured at the same playhead
/// position — would divide by zero when solving the segment.
export function playableKeyframes(schema: InertiaAnimationSchema): Array<InertiaAnimationKeyframe> {
    return (schema.keyframes ?? []).flatMap(keyframe => {
        if (!valuesAreFinite(keyframe.values)) {
            return [];
        }
        if (!Number.isFinite(keyframe.duration) || keyframe.duration <= 0) {
            return [{ ...keyframe, duration: 0.001 }];
        }
        return [keyframe];
    });
}

/// How many corners a round vector's ring is cut into. An oval has no corners of
/// its own, so it is drawn as the many-sided polygon that reads as one at the
/// sizes a shape is authored at — and the same count as the Swift and Kotlin
/// runtimes use, so an oval authored once is the same drawing on all three.
export const ovalSegments = 48;

/// The ring of corners a described vector is drawn from, in the actionable's own
/// units and centred on its top-left corner — the origin the description is
/// measured from.
///
/// Matches the Swift and Kotlin runtimes corner for corner, so one authored
/// vector is the same drawing on all three. A rectangle comes out as the two
/// triangles of a quad rather than four corners; the fan in `shapeTriangles`
/// re-covers the same area from them.
///
/// A square, a circle and a triangle are the descriptions with one measurement
/// rather than two, so each is sized by the longer side of the box it was drawn
/// in — the shape stays square, stays round, stays a triangle whatever box it
/// was dragged out over.
export function describedOutline(properties: InertiaShapeProperties): Array<InertiaPoint> {
    const size = Math.max(properties.width, properties.height);

    /// The ring inscribed in a box: one corner per segment, stepping around the
    /// ellipse.
    const ring = (width: number, height: number): Array<InertiaPoint> => {
        const radiusX = width / 2;
        const radiusY = height / 2;
        const points: Array<InertiaPoint> = [];

        for (let segment = 0; segment < ovalSegments; segment++) {
            const angle = 2 * Math.PI * segment / ovalSegments;
            points.push({ x: radiusX * Math.cos(angle), y: radiusY * Math.sin(angle) });
        }

        return points;
    };

    /// The four corners of a box, drawn about its centre.
    const quad = (width: number, height: number): Array<InertiaPoint> => {
        const halfWidth = width / 2;
        const halfHeight = height / 2;
        return [
            { x: -halfWidth, y: -halfHeight },
            { x: halfWidth, y: -halfHeight },
            { x: halfWidth, y: halfHeight },
            { x: -halfWidth, y: halfHeight }
        ];
    };

    switch (properties.type) {
        case InertiaShapeType.rectangle:
            return quad(properties.width, properties.height);
        case InertiaShapeType.square:
            return quad(size, size);
        case InertiaShapeType.circle:
            return ring(size, size);
        case InertiaShapeType.oval:
            return ring(properties.width, properties.height);
        case InertiaShapeType.triangle: {
            // An isosceles triangle with mirror symmetry about the y-axis.
            const height = size * Math.sqrt(3) / 2;
            const halfBase = size / 2;
            return [
                { x: 0, y: height / 2 },
                { x: -halfBase, y: -height / 2 },
                { x: halfBase, y: -height / 2 }
            ];
        }
    }
}

/// The corners this shape is drawn from, however it was authored: the ones
/// recorded against it, or the ones its description resolves to.
///
/// A described vector resolves to its outline carrying the colour it is filled
/// with — or, for a shape that is only its outline, the colour it is stroked
/// with, so an unfilled shape still says where it is to everything that measures
/// a shape by its corners.
export function shapeVertices(shape: InertiaShape): Array<Vertex> {
    if (shape.vertices) {
        return shape.vertices;
    }

    if (!shape.shape) {
        return [];
    }

    const color = shape.shape.fill ?? shape.shape.stroke ?? { red: 0, green: 0, blue: 0, alpha: 0 };
    return describedOutline(shape.shape).map(position => ({ position, color }));
}

/// A ring of corners as the triangle list a GPU draws: a fan around the first
/// corner, so three corners are a triangle and four a quad. Fewer than three
/// enclose no area and contribute nothing.
///
/// Every ring a shape resolves to is convex, so the fan covers it exactly from
/// whichever corner it starts at.
export function fan(vertices: Array<Vertex>): Array<Vertex> {
    if (vertices.length < 3) {
        return [];
    }

    const triangles: Array<Vertex> = [];
    for (let i = 1; i < vertices.length - 1; i++) {
        triangles.push(vertices[0], vertices[i], vertices[i + 1]);
    }

    return triangles;
}

/// The same ring moved `distance` towards its own inside, corner by corner.
///
/// Each corner travels along the bisector of the two edges meeting at it, far
/// enough that both edges end up exactly `distance` in — which is what makes the
/// band an even thickness all the way round instead of thinning at the corners.
/// Very sharp corners want to travel a very long way, so the distance is capped;
/// the ring is convex and the cap only ever pulls a spike back in.
///
/// Which way "inside" is depends on which way the ring was wound, so that is
/// measured rather than assumed: the sign of the area it encloses.
function insetOutline(outline: Array<InertiaPoint>, distance: number): Array<InertiaPoint> {
    const count = outline.length;

    // Twice the signed area. Only the sign is read.
    let area = 0;
    for (let i = 0; i < count; i++) {
        const corner = outline[i];
        const next = outline[(i + 1) % count];
        area += corner.x * next.y - next.x * corner.y;
    }
    const winding = area < 0 ? -1 : 1;

    const unit = (point: InertiaPoint): InertiaPoint => {
        const length = Math.hypot(point.x, point.y);
        return length > 0 ? { x: point.x / length, y: point.y / length } : { x: 0, y: 0 };
    };

    /// The unit normal of an edge, pointing at the ring's inside.
    const normal = (start: InertiaPoint, end: InertiaPoint): InertiaPoint =>
        unit({ x: -(end.y - start.y) * winding, y: (end.x - start.x) * winding });

    return outline.map((corner, index) => {
        const previous = outline[(index - 1 + count) % count];
        const next = outline[(index + 1) % count];

        const incoming = normal(previous, corner);
        const outgoing = normal(corner, next);
        const bisector = unit({ x: incoming.x + outgoing.x, y: incoming.y + outgoing.y });

        // How far along the bisector puts both edges `distance` in. Zero when
        // the two edges double back on each other, which is a corner with no
        // inside to move towards.
        const projection = bisector.x * outgoing.x + bisector.y * outgoing.y;
        if (!(projection > 0.1)) {
            return corner;
        }

        const travel = distance / projection;
        return { x: corner.x + bisector.x * travel, y: corner.y + bisector.y * travel };
    });
}

/// The outline itself, as triangles: the band between the ring and the same ring
/// inset by `strokeWidth`.
///
/// Inset rather than centred or outset, so a stroke stays inside the box the
/// shape was authored at — see `InertiaShapeProperties.strokeWidth`. Each corner
/// is mitred, so the band turns a corner in one piece rather than leaving the
/// wedge that offsetting each edge on its own would.
function strokeTriangles(properties: InertiaShapeProperties): Array<Vertex> {
    const stroke = properties.stroke;
    const width = properties.strokeWidth ?? 0;
    if (!stroke || !(width > 0)) {
        return [];
    }

    const outline = describedOutline(properties);
    if (outline.length < 3) {
        return [];
    }

    // A stroke thicker than the shape has room for would turn the inner ring
    // inside out. Held at the point where the ring closes on itself, which is a
    // shape drawn solid in the stroke's colour.
    const inset = Math.min(width, Math.min(properties.width, properties.height) / 2);
    const inner = insetOutline(outline, inset);

    const triangles: Array<Vertex> = [];
    for (let i = 0; i < outline.length; i++) {
        const next = (i + 1) % outline.length;
        const corner = (position: InertiaPoint): Vertex => ({ position, color: stroke });

        triangles.push(
            corner(outline[i]), corner(outline[next]), corner(inner[next]),
            corner(outline[i]), corner(inner[next]), corner(inner[i])
        );
    }

    return triangles;
}

/// Everything this shape draws, as the one triangle list a GPU takes: the fill
/// first, then the stroke over it.
///
/// The order is the order they are drawn in — the renderer blends source-over
/// down the list and keeps no depth — which is what puts the outline on top of
/// the area it encloses rather than under it. A shape authored corner by corner
/// is all fill, since a stroke is something a *described* vector carries.
///
/// Everything here comes out placed by `transforms`, children included: a child
/// is drawn into this buffer rather than onto a canvas of its own, so baking the
/// placement into the corners is the only place a nested shape can be moved at
/// all.
export function shapeTriangles(shape: InertiaShape): Array<Vertex> {
    const own = ownTriangles(shape);
    const children = shape.shapes ?? [];
    if (children.length === 0) {
        return placeVertices(own, shape);
    }

    // A child is measured in this shape's box and centred where this shape is
    // centred, so scaling by that box is the whole of the transform: the origin
    // the two share needs no offset. Where the child asked to sit in that box is
    // already in the corners it hands over.
    const unit = childUnit(shape);
    return placeVertices(
        own.concat(children.flatMap(child => scaleVertices(shapeTriangles(child), unit))),
        shape
    );
}

/// `vertices` moved to where `shape.transforms` places it in its parent.
///
/// Scaled and turned about the origin of the parent's box — which is the point a
/// described vector's outline is drawn around, so a shape left where it was
/// authored scales and turns about its own middle — and then moved, in fractions
/// of that same box.
///
/// Both rotations turn about that one point. `rotate` and `rotateCenter` differ
/// only in the anchor a view is turned about, and a ring of corners has no view
/// box to anchor to, so what a shape does with them is the one rotation their
/// sum describes.
///
/// Opacity is carried in the corners' own alpha, since the fade has to survive
/// being flattened into a buffer shared with shapes that are not faded.
///
/// Matches the Swift and Kotlin runtimes corner for corner, so one placed shape
/// is the same drawing on all three.
function placeVertices(vertices: Array<Vertex>, shape: InertiaShape): Array<Vertex> {
    const placement = shape.transforms;
    if (!placement) {
        return vertices;
    }

    const scale = Number.isFinite(placement.scale) ? placement.scale : 1;
    const opacity = Number.isFinite(placement.opacity) ? placement.opacity : 1;
    const [x, y] = placement.translate;
    const translateX = Number.isFinite(x) ? x : 0;
    const translateY = Number.isFinite(y) ? y : 0;
    const degrees = (placement.rotate ?? 0) + (placement.rotateCenter ?? 0);
    const radians = (Number.isFinite(degrees) ? degrees : 0) * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);

    return vertices.map(vertex => {
        const scaledX = vertex.position.x * scale;
        const scaledY = vertex.position.y * scale;

        return {
            position: {
                x: scaledX * cosine - scaledY * sine + translateX,
                y: scaledX * sine + scaledY * cosine + translateY
            },
            color: { ...vertex.color, alpha: vertex.color.alpha * opacity }
        };
    });
}

/// What this shape draws itself, before anything nested inside it.
function ownTriangles(shape: InertiaShape): Array<Vertex> {
    if (shape.vertices || !shape.shape) {
        return fan(shapeVertices(shape));
    }

    const properties = shape.shape;
    const fill = properties.fill;
    const outline = describedOutline(properties);
    const filled = fill ? fan(outline.map(position => ({ position, color: fill }))) : [];

    return filled.concat(strokeTriangles(properties));
}

/// The length a child's coordinates are multiples of: the shorter side of this
/// shape's own box, in whatever units this shape is itself measured in.
///
/// A described vector says its size outright. One authored corner by corner does
/// not, so it is measured — the box its own corners occupy, which is the same
/// thing the description would have named.
///
/// One length rather than two, for the reason the actionable's own unit is one
/// length — see `shapeUnit`. Scaling a child by this box's width across and its
/// height down would stretch it in whatever direction the parent happens to be
/// longer in, so a circle nested in a wide rectangle came out an oval; measured
/// against the shorter side it is the circle it was described as, wherever it is
/// nested.
function childUnit(shape: InertiaShape): number {
    if (shape.shape && !shape.vertices) {
        return Math.min(shape.shape.width, shape.shape.height);
    }

    const positions = shapeVertices(shape).map(vertex => vertex.position);
    const first = positions[0];
    if (!first) {
        return 0;
    }

    let minX = first.x, maxX = first.x, minY = first.y, maxY = first.y;
    positions.forEach(position => {
        minX = Math.min(minX, position.x);
        maxX = Math.max(maxX, position.x);
        minY = Math.min(minY, position.y);
        maxY = Math.max(maxY, position.y);
    });

    return Math.min(maxX - minX, maxY - minY);
}

function scaleVertices(vertices: Array<Vertex>, unit: number): Array<Vertex> {
    return vertices.map(vertex => ({
        position: { x: vertex.position.x * unit, y: vertex.position.y * unit },
        color: vertex.color
    }));
}

/// Every corner this shape's drawing reaches, its children's included, in the
/// units this shape is measured in.
///
/// What the canvas is fitted to — see `shapeBounds`. A ring of corners alone
/// would leave a child hanging over the edge of the canvas its parent sized, and
/// cut it there.
///
/// Placed by `transforms`, the same as the triangles are: the canvas is fitted
/// to where the drawing ends up, not to where it was drawn.
export function enclosingShapeVertices(shape: InertiaShape): Array<Vertex> {
    const children = shape.shapes ?? [];
    if (children.length === 0) {
        return placeVertices(shapeVertices(shape), shape);
    }

    const unit = childUnit(shape);
    return placeVertices(
        shapeVertices(shape)
            .concat(children.flatMap(child => scaleVertices(enclosingShapeVertices(child), unit))),
        shape
    );
}

/// The smallest box holding every corner of these shapes, in the units they are
/// authored in — multiples of the actionable's shorter side, so a box 1 wide is
/// as wide as that side and one 3 wide three times it.
///
/// This is what the canvas is sized and placed by. Sizing it to the shapes
/// rather than to the container is what keeps a shape whole: a canvas is a
/// rectangle that rotates with the view it backs, so anything reaching past its
/// edge is cut — and a canvas fitted to the container was already cutting a
/// shape bigger than the container, then sweeping that straight edge through
/// the artwork as the view turned. Fitted to the shapes, there is nothing
/// outside it to lose.
///
/// Null when the shapes enclose no area, which is also when there is nothing to
/// draw.
export function shapeBounds(shapes: Array<InertiaShape>): InertiaRect | null {
    const positions = shapes.flatMap(shape => enclosingShapeVertices(shape).map(vertex => vertex.position));
    const first = positions[0];
    if (!first) {
        return null;
    }

    let minX = first.x;
    let maxX = first.x;
    let minY = first.y;
    let maxY = first.y;

    positions.forEach(position => {
        minX = Math.min(minX, position.x);
        maxX = Math.max(maxX, position.x);
        minY = Math.min(minY, position.y);
        maxY = Math.max(maxY, position.y);
    });

    const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    return bounds.width > 0 && bounds.height > 0 ? bounds : null;
}

/// The same shape restated against `bounds` — the canvas's own box — so (0, 0)
/// is the canvas's top-left corner and (1, 1) its bottom-right, which is the
/// space the renderer draws in.
///
/// Triangles rather than corners, because by this point the shape *is* its
/// drawing: the fill and the stroke have been resolved into one list, and a ring
/// of corners could no longer say which of the two it was.
export function normalizedShapeTriangles(shape: InertiaShape, bounds: InertiaRect): Array<Vertex> {
    const triangles = shapeTriangles(shape);
    if (!(bounds.width > 0) || !(bounds.height > 0)) {
        return triangles;
    }

    return triangles.map(vertex => ({
        position: {
            x: (vertex.position.x - bounds.x) / bounds.width,
            y: (vertex.position.y - bounds.y) / bounds.height
        },
        color: vertex.color
    }));
}

/// How long this schema's own track runs, before any padding.
export function trackDuration(schema: InertiaAnimationSchema): number {
    return playableKeyframes(schema).reduce((total, keyframe) => total + keyframe.duration, 0);
}

/// The playable track held at its final values until `duration` is up.
///
/// Without this a track that ends after one second would restart three times
/// while a three-second one runs once, and the playhead — which follows the
/// loop rather than any one actionable — would agree with neither.
export function keyframesFilling(schema: InertiaAnimationSchema, duration: number): Array<InertiaAnimationKeyframe> {
    const track = playableKeyframes(schema);
    const last = track[track.length - 1];
    if (!last) {
        return track;
    }

    const remainder = duration - track.reduce((total, keyframe) => total + keyframe.duration, 0);
    if (remainder <= 0.001) {
        return track;
    }

    return [...track, { id: `${last.id}--hold`, values: last.values, duration: remainder }];
}

/// Approximates the runtime's cubic keyframes: eased in and out of every
/// segment rather than a linear ramp between them.
function easeInOut(fraction: number): number {
    return fraction < 0.5
        ? 4 * fraction * fraction * fraction
        : 1 - Math.pow(-2 * fraction + 2, 3) / 2;
}

function interpolate(from: InertiaAnimationValues, to: InertiaAnimationValues, fraction: number): InertiaAnimationValues {
    const t = easeInOut(Math.min(Math.max(fraction, 0), 1));
    const lerp = (a: number, b: number) => a + (b - a) * t;

    return {
        scale: lerp(from.scale, to.scale),
        translate: [lerp(from.translate[0], to.translate[0]), lerp(from.translate[1], to.translate[1])],
        rotate: lerp(from.rotate, to.rotate),
        rotateCenter: lerp(from.rotateCenter, to.rotateCenter),
        opacity: lerp(from.opacity, to.opacity)
    };
}

/// The values this schema's track reaches `time` seconds into a loop of
/// `loopDuration`.
///
/// Playing, pausing and scrubbing are all the same thing to a runtime that
/// draws from the editor's clock: read the track at the playhead. It is also
/// the only way play can pick up mid-loop.
export function valuesAtTime(
    schema: InertiaAnimationSchema,
    time: number,
    loopDuration: number,
    isRepeating: boolean = true
): InertiaAnimationValues {
    // A run that plays once is as long as its own track — padding it to the loop
    // would only hold it at the end, which is what the loop is for.
    const track = isRepeating ? keyframesFilling(schema, loopDuration) : playableKeyframes(schema);
    let previous = sanitizeValues(schema.initialValues);

    if (track.length === 0) {
        return previous;
    }

    let elapsed = 0;
    for (const keyframe of track) {
        const values = sanitizeValues(keyframe.values);
        if (time <= elapsed + keyframe.duration) {
            return interpolate(previous, values, (time - elapsed) / keyframe.duration);
        }
        elapsed += keyframe.duration;
        previous = values;
    }

    return previous;
}

export class WebSocketClient {
    private static instance: WebSocketClient;
    private socket: WebSocket | null = null;
    public isConnected = false;

    public messageReceived?: (selectedIds: Set<ActionableIdPair>) => void;
    public messageReceivedSchema?: (schemas: InertiaSchemaWrapper[]) => void;
    public messageReceivedIsActionable?: (isActionable: boolean) => void;
    public messageReceivedTranslationEnded?: (actionableIds: Set<ActionableIdPair>, translationX: number, translationY: number) => void;
    public messageReceivedSignal?: (signal: AnimationSignal, sequence: number) => void;
    public messageReceivedTool?: (tool: InertiaTool) => void;

    /// How long to wait before dialing the editor again. The editor is not
    /// usually up when the page loads, and it can be restarted under a running
    /// app, so a connection that is never retried means a dev session that
    /// silently never connects.
    private static readonly reconnectDelayMs = 2000;

    private uri: string | null = null;
    private onConnect: (() => void) | null = null;
    /// Everything that wants to know the moment an editor attaches, rather than
    /// only at the one place that dials it.
    ///
    /// `onConnect` belongs to whoever called `connect` — the container — and is
    /// replaced by the next caller. A node reporting its own measurement cannot
    /// take that slot from it, and cannot wait for a layout that already
    /// happened, so it listens here instead.
    private connectedListeners = new Set<() => void>();
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private isReconnecting = false;

    private constructor() {}

    public static get shared(): WebSocketClient {
        if (!WebSocketClient.instance) {
            WebSocketClient.instance = new WebSocketClient();
        }
        return WebSocketClient.instance;
    }

    /// Calls `listener` every time the socket comes up, and hands back the way
    /// to stop listening — which a caller mounted and unmounted with a node has
    /// to have.
    public addConnectedListener(listener: () => void): () => void {
        this.connectedListeners.add(listener);
        return () => {
            this.connectedListeners.delete(listener);
        };
    }

    public connect(uri: string, onConnect: () => void): void {
        // Later calls re-arm the handlers — a remounted container has to be able
        // to replace the ones its previous instance installed.
        this.uri = uri;
        this.onConnect = onConnect;

        if (this.isConnected) {
            onConnect();
            return;
        }

        // A dial is already in flight, or one is scheduled.
        if (this.socket?.readyState === WebSocket.CONNECTING || this.reconnectTimer !== null) {
            return;
        }

        this.openSocket();
    }

    private openSocket(): void {
        if (!this.uri) {
            return;
        }

        let socket: WebSocket;
        try {
            socket = new WebSocket(this.uri);
        } catch (error) {
            // Constructing the socket can throw outright — a malformed URI, or a
            // page served over https refusing the ws:// dial. Nothing will call
            // `onclose` for a socket that was never built, so the retry has to be
            // armed here or the loop stops on the first one of these.
            console.log("[INERTIA_LOG]: WebSocket could not be opened — will retry", error);
            this.scheduleReconnect();
            return;
        }

        // Every frame is MessagePack, so they arrive as bytes. Without this a
        // browser hands them over as a Blob, which is only readable
        // asynchronously — an await per playback frame.
        socket.binaryType = "arraybuffer";

        this.socket = socket;

        socket.onopen = () => {
            this.isConnected = true;
            this.isReconnecting = false;
            console.log("WebSocket connected");
            this.onConnect?.();
            for (const listener of this.connectedListeners) {
                listener();
            }
        };

        socket.onmessage = (event: MessageEvent) => {
            this.handleMessage(event.data);
        };

        socket.onerror = () => {
            // Failing to reach an editor that is not running yet is the normal
            // case, so this is not worth an error-level log on every retry.
            if (!this.isReconnecting) {
                console.log("[INERTIA_LOG]: WebSocket error — will retry");
            }
        };

        socket.onclose = () => {
            const wasConnected = this.isConnected;
            this.isConnected = false;
            if (wasConnected) {
                console.log("WebSocket disconnected");
            }
            this.scheduleReconnect();
        };
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer !== null || !this.uri) {
            return;
        }

        this.isReconnecting = true;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.openSocket();
        }, WebSocketClient.reconnectDelayMs);
    }

    /// Stops dialing and drops the connection. Nothing in the runtime calls this
    /// — a container that unmounts leaves the socket up for the next one — but a
    /// host page that tears the runtime down needs a way out of the retry loop.
    public disconnect(): void {
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.uri = null;
        this.onConnect = null;
        this.isReconnecting = false;
        this.socket?.close();
        this.socket = null;
        this.isConnected = false;
    }

    /// Every message on this socket is one wrapper carrying the inner message as
    /// a *separately encoded* MessagePack document — that is how Swift writes a
    /// `Data` payload, and the editor decodes it back the same way.
    private send(type: MessageType, message: unknown): boolean {
        if (!this.socket || !this.isConnected) {
            console.error("WebSocket is not connected");
            return false;
        }

        const messageWrapper: MessageWrapper = {
            type,
            payload: encode(message)
        };

        try {
            // `encode` returns a view onto a larger buffer, so hand `send` the
            // view rather than its `buffer` — that would send the slack too.
            const bytes = encode(messageWrapper);
            this.socket.send(bytes.slice());
            return true;
        } catch (error) {
            console.error("❌ Error sending message:", error);
            return false;
        }
    }

    /// The tree is flattened on the way out rather than left to the encoder.
    /// `JSON.stringify` used to call `Tree.toJSON` for us, which is what dropped
    /// the `parent` and `tree` back-references; MessagePack has no such hook, so
    /// encoding a live `Tree` would walk straight into those cycles.
    public sendMessageActionables(message: MessageActionables): void {
        const sent = this.send(MessageType.actionables, {
            ...message,
            tree: message.tree.toJSON(),
            actionableIds: Array.from(message.actionableIds),
        });

        if (sent) {
            console.log("✅ Message sent:", MessageType.actionables, message);
        }
    }

    public sendMessageSchema(message: MessageSchema): void {
        this.send(MessageType.schema, message);
    }

    public sendMessageSelectedNodeProperties(message: MessageSelectedNodeProperties): void {
        this.send(MessageType.selectedNodeProperties, message);
    }

    public sendMessageNodeMeasured(message: MessageNodeMeasured): void {
        this.send(MessageType.nodeMeasured, message);
    }

    /// The playhead moves every frame, and a stall anywhere downstream would let
    /// sends pile up in the socket layer and then burst. At most one report is
    /// in flight at a time; anything produced while one is draining overwrites
    /// the last and rides the next send.
    ///
    /// The last report of a run is exempt: `isRunning: false` is what returns
    /// the editor's transport controls to their paused state, and there is no
    /// following report to carry it if this one is dropped.
    public sendMessagePlaybackProgress(message: MessagePlaybackProgress): void {
        this.pendingPlaybackProgress = message;

        if (!this.socket || !this.isConnected) {
            return;
        }

        if (message.isRunning && this.socket.bufferedAmount > 0) {
            return;
        }

        const pending = this.pendingPlaybackProgress;
        this.pendingPlaybackProgress = null;
        this.send(MessageType.playbackProgress, pending);
    }

    private pendingPlaybackProgress: MessagePlaybackProgress | null = null;

    public sendMessageTranslation(message: MessageTranslation): void {
        // Convert Set → Array for JSON compatibility
        const sent = this.send(MessageType.translationEnded, {
            ...message,
            actionableIds: Array.from(message.actionableIds),
        });

        if (sent) {
            console.log("✅ Message sent:", MessageType.translationEnded, message);
        }
    }

    /// One message whatever the tool, carrying the whole transform: a keyframe
    /// holds all five values, so the four a gesture did not touch have to travel
    /// with the one it did.
    public sendMessageEdit(message: MessageEdit): void {
        const sent = this.send(MessageType.edit, {
            ...message,
            actionableIds: Array.from(message.actionableIds),
        });

        if (sent) {
            console.log("✅ Message sent:", MessageType.edit, message);
        }
    }


    private async handleMessage(rawData: any): Promise<void> {
        try {
            let bytes: Uint8Array;

            // `binaryType` is set to "arraybuffer" on every socket this opens,
            // but a Blob is what a socket left at its default would deliver.
            if (rawData instanceof ArrayBuffer) {
                bytes = new Uint8Array(rawData);
            } else if (rawData instanceof Blob) {
                bytes = new Uint8Array(await rawData.arrayBuffer());
            } else if (rawData instanceof Uint8Array) {
                bytes = rawData;
            } else {
                throw new Error("Unsupported message format — frames are MessagePack");
            }

            const messageWrapper = decode(bytes) as MessageWrapper;
            const payload: any = decode(messageWrapper.payload);

            switch (messageWrapper.type) {
                case MessageType.actionable:
                    const actionableMessage: MessageActionable = payload;
                    console.log("[INERTIA_LOG]: Received actionable:", actionableMessage);
                    this.messageReceivedIsActionable?.(actionableMessage.isActionable);
                    break;

                case MessageType.actionables:
                    const msg: MessageActionables = payload;
                    console.log("[INERTIA_LOG]: Received actionables:", msg);
                    this.messageReceived?.(new Set(msg.actionableIds));
                    break;

                case MessageType.schema:
                    const schemaMessage: MessageSchema = payload;
                    console.log("[INERTIA_LOG]: Received schema:", schemaMessage);
                    this.messageReceivedSchema?.(schemaMessage.schemaWrappers);
                    break;

                case MessageType.translationEnded:
                    const translationMSG: MessageTranslation = payload
                    console.log("[INERTIA_LOG]: Received translationEnded:", translationMSG);
                    this.messageReceivedTranslationEnded?.(new Set(translationMSG.actionableIds), translationMSG.translationX, translationMSG.translationY)
                    break

                case MessageType.tool:
                    const toolMessage: MessageTool = payload;
                    console.log("[INERTIA_LOG]: Received tool:", toolMessage);
                    this.messageReceivedTool?.(toolMessage.tool);
                    break;

                case MessageType.signal:
                    const signalMessage: { signal: unknown; sequence: number } = payload;
                    const signal = decodeAnimationSignal(signalMessage.signal);
                    if (!signal) {
                        console.error("[INERTIA_LOG]: Unrecognized signal:", signalMessage.signal);
                        break;
                    }
                    console.log("[INERTIA_LOG]: Received signal:", signal, "sequence:", signalMessage.sequence);
                    this.messageReceivedSignal?.(signal, signalMessage.sequence ?? 0);
                    break;
            }
        } catch (error) {
            console.error("❌ Error parsing message:", error, rawData);
        }
    }

}