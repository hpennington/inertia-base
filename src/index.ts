export interface InertiaAnimationSchema {
    id: string;
    initialValues: InertiaAnimationValues;
    invokeType: InertiaAnimationInvokeType;
    keyframes: Array<InertiaAnimationKeyframe>;
    /// What the actionable's canvas draws behind it. Optional to author, so an
    /// animation recorded before shapes existed — or one that simply wants none
    /// — still loads.
    shapes?: Array<InertiaShape>;
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
    oval = "oval",
    triangle = "triangle"
}

/// A drawn vector as the editor records it: what it is and how big, in the same
/// multiples of the actionable its corners would have been measured in.
export type InertiaShapeProperties = {
    id: string;
    type: InertiaShapeType;
    width: number;
    height: number;
}

/// A shape as it is authored alongside an animation: a ring of corners, each
/// carrying its own colour, measured against the actionable it belongs to —
/// (0, 0) that view's top-left, (1, 1) its bottom-right.
///
/// Nothing holds a shape to that box, though. Coordinates outside 0...1 reach
/// past the actionable and go on being drawn, because the canvas is fitted to
/// the shapes rather than to the view: a shape three times the size of the card
/// it backs is authored simply by saying 3.
///
/// A shape is authored one of two ways — `vertices`, corner by corner, or
/// `shape`, a vector described and drawn from that description — and may carry
/// an `animation` of its own, which is what makes it a drawing rather than a
/// backdrop: the corners say what is drawn, the track says how it moves, and
/// the actionable it was authored against carries both.
export type InertiaShape = {
    vertices?: Array<Vertex>;
    shape?: InertiaShapeProperties;
    animation?: InertiaAnimationSchema;
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
    playbackProgress = "playbackProgress"
}

export interface MessageWrapper<T = any> {
    type: MessageType;
    payload: T;
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

function base64Encode(str: string): string {
    // Convert UTF-8 string to bytes
    const bytes = new TextEncoder().encode(str);
    // Convert bytes to binary string
    let binary = '';
    bytes.forEach((b) => binary += String.fromCharCode(b));
    // Base64 encode
    return btoa(binary);
}

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
/// with associated values as a single-key object — `{"seek": {"_0": 1.25}}` —
/// which is what `decodeAnimationSignal` unpacks.
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

const identityValues: InertiaAnimationValues = {
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

/// The colour a described vector is drawn in until the editor records one of
/// its own. Shared with the Swift and Kotlin runtimes, which draw the same
/// placeholder.
const describedShapeColor: InertiaColor = { red: 1, green: 0, blue: 0, alpha: 1 };

/// The ring of corners a described vector is drawn from, in the actionable's own
/// units and centred on its top-left corner — the origin the description is
/// measured from.
///
/// Matches the Swift and Kotlin runtimes corner for corner, so one authored
/// vector is the same drawing on all three. A rectangle comes out as the two
/// triangles of a quad rather than four corners; the fan in `shapeTriangles`
/// re-covers the same area from them.
function describedVertices(properties: InertiaShapeProperties): Array<Vertex> {
    const size = Math.max(properties.width, properties.height);
    const corner = (x: number, y: number): Vertex => ({
        position: { x, y },
        color: describedShapeColor
    });

    if (properties.type === InertiaShapeType.triangle) {
        const height = size * Math.sqrt(3) / 2;
        const halfBase = size / 2;
        return [
            corner(0, height / 2),
            corner(-halfBase, -height / 2),
            corner(halfBase, -height / 2)
        ];
    }

    // An oval has no drawing of its own yet and is squared off, the way the
    // other runtimes leave it.
    const half = size / 2;
    const topLeft = corner(-half, -half);
    const topRight = corner(half, -half);
    const bottomLeft = corner(-half, half);
    const bottomRight = corner(half, half);
    return [topLeft, topRight, bottomRight, topLeft, bottomLeft, bottomRight];
}

/// The corners this shape is drawn from, however it was authored: the ones
/// recorded against it, or the ones its description resolves to.
export function shapeVertices(shape: InertiaShape): Array<Vertex> {
    if (shape.vertices) {
        return shape.vertices;
    }

    return shape.shape ? describedVertices(shape.shape) : [];
}

/// The shape as the triangle list a GPU draws: a fan around the first corner,
/// so three corners are a triangle and four a quad. Fewer than three enclose no
/// area and contribute nothing.
export function shapeTriangles(shape: InertiaShape): Array<Vertex> {
    const vertices = shapeVertices(shape);
    if (vertices.length < 3) {
        return [];
    }

    const triangles: Array<Vertex> = [];
    for (let i = 1; i < vertices.length - 1; i++) {
        triangles.push(vertices[0], vertices[i], vertices[i + 1]);
    }

    return triangles;
}

/// The smallest box holding every corner of these shapes, in the units they are
/// authored in — multiples of the actionable's own frame, so `(0, 0, 1, 1)` is
/// exactly the actionable and `(0, 0, 3, 3)` three times it.
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
    const positions = shapes.flatMap(shape => shapeVertices(shape).map(vertex => vertex.position));
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
/// The corners are resolved on the way through: whatever the shape was authored
/// as, what comes out is the ring that lands in `bounds`. Its animation rides
/// along, since normalizing is about where the shape is drawn and not about what
/// it then does.
export function normalizeShape(shape: InertiaShape, bounds: InertiaRect): InertiaShape {
    if (!(bounds.width > 0) || !(bounds.height > 0)) {
        return shape;
    }

    return {
        vertices: shapeVertices(shape).map(vertex => ({
            position: {
                x: (vertex.position.x - bounds.x) / bounds.width,
                y: (vertex.position.y - bounds.y) / bounds.height
            },
            color: vertex.color
        })),
        animation: shape.animation
    };
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

    /// How long to wait before dialing the editor again. The editor is not
    /// usually up when the page loads, and it can be restarted under a running
    /// app, so a connection that is never retried means a dev session that
    /// silently never connects.
    private static readonly reconnectDelayMs = 2000;

    private uri: string | null = null;
    private onConnect: (() => void) | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private isReconnecting = false;

    private constructor() {}

    public static get shared(): WebSocketClient {
        if (!WebSocketClient.instance) {
            WebSocketClient.instance = new WebSocketClient();
        }
        return WebSocketClient.instance;
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

        this.socket = socket;

        socket.onopen = () => {
            this.isConnected = true;
            this.isReconnecting = false;
            console.log("WebSocket connected");
            this.onConnect?.();
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
    /// a *separately encoded* JSON document, base64'd — that is how Swift writes
    /// a `Data` payload, and the editor decodes it back the same way.
    private send(type: MessageType, message: unknown): boolean {
        if (!this.socket || !this.isConnected) {
            console.error("WebSocket is not connected");
            return false;
        }

        const messageWrapper: MessageWrapper<string> = {
            type,
            payload: base64Encode(JSON.stringify(message))
        };

        try {
            this.socket.send(JSON.stringify(messageWrapper));
            return true;
        } catch (error) {
            console.error("❌ Error sending message:", error);
            return false;
        }
    }

    public sendMessageActionables(message: MessageActionables): void {
        if (this.send(MessageType.actionables, message)) {
            console.log("✅ Message sent:", MessageType.actionables, message);
        }
    }

    public sendMessageSchema(message: MessageSchema): void {
        this.send(MessageType.schema, message);
    }

    public sendMessageSelectedNodeProperties(message: MessageSelectedNodeProperties): void {
        this.send(MessageType.selectedNodeProperties, message);
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


    private async handleMessage(rawData: any): Promise<void> {
        try {
            let text: string;

            if (typeof rawData === "string") {
                text = rawData;
            } else if (rawData instanceof Blob) {
                text = await rawData.text();
            } else if (rawData instanceof ArrayBuffer) {
                text = new TextDecoder().decode(rawData);
            } else {
                throw new Error("Unsupported message format");
            }

            const messageWrapper: MessageWrapper<string> = JSON.parse(text);

            // Decode Base64 payload
            const payloadJson = atob(messageWrapper.payload);
            const payload = JSON.parse(payloadJson);

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