// 台中一中 GTA - 主遊戲文件
class Game {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.player = null;
        this.buildings = [];
        this.solids = [];
        this.surfaces = [];       // 可走上去的表面（坡道、台階、平台）
        this.blockers = [];       // 擋人的欄杆、矮牆、機台（低於頂端高度就撞牆）
        this.maxStep = 0.35;      // 一步最多能跨上多高；超過就像撞牆（要用跳的）
        this.planSurfaces = [];
        this.planPaths = [];
        this.controls = {};
        this.clock = new THREE.Clock();
        this.isLoading = true;
        this.gameState = 'loading';
        this.isMobile = this.detectMobile();
        // ── 比例設定：想調整「人 vs 建築」的大小感，改這兩個數字就好 ──
        this.heightScale = 1.3;   // 建築物樓高倍率（每層樓更高、更有壓迫感）
        this.playerScale = 0.72;  // 玩家大小（原本偏大，約 2.7 m；0.72 約 1.9 m）
        this.playerGround = 1 * this.playerScale;   // 玩家中心離地高度（腳剛好貼地）
        this.columns = [];        // 圓柱碰撞（挑空走道裡的柱子）
        this.vehicles = [];
        this.currentVehicle = null;
        this.currentSpeed = 0;
        this.pedestrians = [];
        this.wantedLevel = 0;
        this.wantedRadius = 0;
        this.wantedCenter = null;
        this.wantedEscapeTime = 0;
        this.wantedRing = null;
        this.instructors = [];
        this.maxWantedLevel = 3;
        this.maxWantedRadius = 32;
        this.coverZones = [];
        this.minorViolationZones = [];
        this.propertyDamageZones = [];
        this.lastVehicleViolationZone = null;
        this.wantedLastSeen = null;
        this.whistlePlayed = false;
        this.wantedRoadblocks = [];
        this.wantedRoadblockColliders = [];
        this.isExploringOutsideCampus = false;
        this.touchControls = {
            joystickActive: false,
            joystickX: 0,
            joystickY: 0,
            lookActive: false,
            lastTouchX: 0,
            lastTouchY: 0
        };
        
        // 小地圖相關
        this.minimapCanvas = null;
        this.minimapCtx = null;
        this.minimapExpanded = false;
        this.minimapRange = 48;
        this.minimapExpandedRange = 105;
        
        this.init();
    }
    
    init() {
        this.setupScene();
        this.setupCamera();
        this.setupRenderer();
        this.setupLights();
        this.setupPlayer();
        this.setupBuildings();
        this.setupControls();
        this.createPedestrians();
        this.setupEventListeners();
        this.animate();
        
        // 模擬載入
        this.simulateLoading();
        
        // 初始化小地圖
        this.initMinimap();
    }
    
    initMinimap() {
        const minimapDiv = document.getElementById('minimap');
        if (!minimapDiv) return;
        
        this.minimapCanvas = document.getElementById('minimap-canvas');
        if (!this.minimapCanvas) {
            this.minimapCanvas = document.createElement('canvas');
            this.minimapCanvas.id = 'minimap-canvas';
        }
        this.minimapCanvas.width = 320;
        this.minimapCanvas.height = 320;
        this.minimapCanvas.style.width = '100%';
        this.minimapCanvas.style.height = '100%';
        minimapDiv.appendChild(this.minimapCanvas);

        this.minimapCtx = this.minimapCanvas.getContext('2d');
        const toggle = document.getElementById('map-toggle');
        if (toggle) {
            toggle.addEventListener('click', () => this.toggleMinimap());
        }
        minimapDiv.addEventListener('click', (event) => {
            if (event.target === this.minimapCanvas) this.toggleMinimap();
        });
        this.updateMinimapMode();
    }

    toggleMinimap() {
        this.minimapExpanded = !this.minimapExpanded;
        this.updateMinimapMode();
    }

    updateMinimapMode() {
        const minimap = document.getElementById('minimap');
        const toggle = document.getElementById('map-toggle');
        if (!minimap) return;
        minimap.classList.toggle('expanded', this.minimapExpanded);
        if (toggle) {
            toggle.textContent = this.minimapExpanded ? '縮小' : '放大';
            toggle.setAttribute('aria-label', this.minimapExpanded ? '縮小地圖' : '放大地圖');
        }
    }
    
    updateMinimap() {
        if (!this.minimapCtx || !this.player) return;
        const ctx = this.minimapCtx, W = this.minimapCanvas.width, H = this.minimapCanvas.height;
        const center = this.player.position;
        const range = this.minimapExpanded ? this.minimapExpandedRange : this.minimapRange;
        const scale = Math.min(W, H) / (range * 2);
        const angle = this.controls.cameraAngle;
        const sin = Math.sin(angle), cos = Math.cos(angle);
        const toCanvas = point => {
            const dx = (center.x - point.x) * scale;
            const dz = (center.z - point.z) * scale;
            return {
                x: W / 2 + dx * cos - dz * sin,
                y: H / 2 + dx * sin + dz * cos
            };
        };
        const points = this.campusBoundary || [];
        if (!points.length) return;
        const drawPolygon = (polygon, color, stroke) => {
            if (!polygon || polygon.length < 3) return;
            ctx.beginPath();
            polygon.forEach((point, index) => {
                const screen = toCanvas(point);
                if (index === 0) ctx.moveTo(screen.x, screen.y);
                else ctx.lineTo(screen.x, screen.y);
            });
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            if (stroke) {
                ctx.strokeStyle = stroke;
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        };

        ctx.clearRect(0, 0, W, H);
        ctx.save();
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#d6d2c7';
        ctx.fillRect(0, 0, W, H);
        drawPolygon(points, '#72836c', '#263127');
        for (const surface of this.planSurfaces) drawPolygon(surface.points, surface.color, null);
        for (const path of this.planPaths) {
            ctx.beginPath();
            path.points.forEach((point, index) => {
                const screen = toCanvas(point);
                if (index === 0) ctx.moveTo(screen.x, screen.y);
                else ctx.lineTo(screen.x, screen.y);
            });
            ctx.strokeStyle = path.color;
            ctx.lineWidth = Math.max(1, path.width * scale);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
        }
        if (this.wantedLevel && this.wantedCenter) {
            const alertCenter = toCanvas(this.wantedCenter);
            ctx.beginPath();
            ctx.arc(alertCenter.x, alertCenter.y, this.wantedRadius * scale, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 45, 54, 0.9)';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        const labels = [];
        for (const building of this.buildings) {
            if (!building.footprint) continue;
            drawPolygon(building.footprint, `#${building.mapColor.toString(16).padStart(6, '0')}`, '#27302a');
            const center = {
                x: building.footprint.reduce((sum, point) => sum + point.x, 0) / building.footprint.length,
                z: building.footprint.reduce((sum, point) => sum + point.z, 0) / building.footprint.length
            };
            labels.push({ name: building.name, ...toCanvas(center) });
        }

        if (this.minimapExpanded) {
            ctx.font = 'bold 12px Microsoft JhengHei, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(24, 28, 24, 0.95)';
            ctx.fillStyle = '#fffdf4';
            for (const label of labels) {
                ctx.strokeText(label.name, label.x, label.y);
                ctx.fillText(label.name, label.x, label.y);
            }
        }

        const player = toCanvas(this.player.position);
        for (const vehicle of this.vehicles) {
            if (vehicle === this.currentVehicle) continue;
            const point = toCanvas(vehicle.mesh.position);
            ctx.fillStyle = vehicle.stolen ? '#777' : vehicle.mapColor;
            ctx.fillRect(point.x - 2, point.y - 2, 4, 4);
        }
        for (const instructor of this.instructors) {
            const point = toCanvas(instructor.mesh.position);
            ctx.fillStyle = '#ff343b';
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            if (this.wantedLevel) {
                const cone = instructor.sightRadius * scale;
                const facing = instructor.mesh.rotation.y;
                const halfAngle = instructor.sightAngle / 2;
                ctx.beginPath();
                ctx.moveTo(point.x, point.y);
                for (let step = 0; step <= 12; step++) {
                    const direction = facing - halfAngle + halfAngle * 2 * step / 12;
                    const target = toCanvas({
                        x: instructor.mesh.position.x + Math.sin(direction) * instructor.sightRadius,
                        z: instructor.mesh.position.z + Math.cos(direction) * instructor.sightRadius
                    });
                    ctx.lineTo(target.x, target.y);
                }
                ctx.closePath();
                ctx.fillStyle = 'rgba(240, 40, 48, 0.16)';
                ctx.fill();
            }
            ctx.fillStyle = '#ff343b';
            ctx.beginPath();
            ctx.arc(point.x, point.y, this.minimapExpanded ? 9 : 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        ctx.save();
        ctx.translate(player.x, player.y);
        ctx.fillStyle = '#e3483d';
        ctx.beginPath();
        ctx.moveTo(0, -14);
        ctx.lineTo(-9, 10);
        ctx.lineTo(9, 10);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.restore();
    }
    
    setupScene() {
        this.scene = new THREE.Scene();
        
        // 添加天空盒（Skybox）- 增加真實感
        const skyGeometry = new THREE.SphereGeometry(500, 32, 32);
        const skyMaterial = new THREE.MeshBasicMaterial({
            color: 0x87CEEB,
            side: THREE.BackSide,
            fog: false
        });
        const sky = new THREE.Mesh(skyGeometry, skyMaterial);
        this.scene.add(sky);
        
        // 添加遠處霧效 - 更真實的距離霧
        this.scene.fog = new THREE.FogExp2(0xBFE3F5, 0.005);
        
        // 添加漸變背景
        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 2;
        const context = canvas.getContext('2d');
        const gradient = context.createLinearGradient(0, 0, 0, 2);
        gradient.addColorStop(0, '#87CEEB');  // 天空藍
        gradient.addColorStop(1, '#E0F6FF');  // 淺藍
        context.fillStyle = gradient;
        context.fillRect(0, 0, 2, 2);
        
        const texture = new THREE.CanvasTexture(canvas);
        this.scene.background = texture;
    }
    
    setupCamera() {
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 5, -105);
    }
    
    setupRenderer() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.NoToneMapping; // 電影級色調映射
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace; // 更準確的色彩
        document.getElementById('game-container').appendChild(this.renderer.domElement);
    }
    
    setupLights() {
        // 環境光 - 更真實的環境光
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.22);
        this.scene.add(ambientLight);
        
        // 主光源（太陽） - 更真實的日光效果
        const directionalLight = this.sun = new THREE.DirectionalLight(0xfff3dc, 0.95);
        directionalLight.position.set(50, 100, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048; // 提高陰影品質
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 500;
        directionalLight.shadow.camera.left = -60;
        directionalLight.shadow.camera.right = 60;
        directionalLight.shadow.camera.top = 60;
        directionalLight.shadow.camera.bottom = -60;
        directionalLight.shadow.bias = -0.0001;
        directionalLight.shadow.normalBias = 0.02;
        this.scene.add(directionalLight);
        this.scene.add(directionalLight.target);
        
        // 添加半影光（填充光） - 讓陰影更自然
        const fillLight = new THREE.DirectionalLight(0x9ccfff, 0.18);
        fillLight.position.set(-50, 50, -50);
        this.scene.add(fillLight);
        
        // 添加環境光反射 - 模擬天空光
        const hemisphereLight = new THREE.HemisphereLight(0xbfe3ff, 0x8fa873, 0.55);
        this.scene.add(hemisphereLight);
    }
    
    setupPlayer() {
        // 創建玩家角色（使用CylinderGeometry代替CapsuleGeometry）
        const playerGeometry = new THREE.CylinderGeometry(0.43, 0.46, 1.25, 10);
        const playerMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x141414,
            roughness: 0.7,
            metalness: 0.0
        });
        this.player = new THREE.Mesh(playerGeometry, playerMaterial);
        this.player.position.y = 0.15;
        const spawn = this.projectMapPoint(120.68622, 24.14943);
        this.player.scale.setScalar(this.playerScale);
        this.player.position.set(spawn.x, this.playerGround, spawn.z);
        this.player.castShadow = true;
        this.player.receiveShadow = true;
        this.playerAnimation = { phase: 0, arms: [], legs: [], avatar: null };
        this.scene.add(this.player);
        this.buildPlayerAvatar();
        
        // 玩家狀態
        this.player.velocity = new THREE.Vector3();
        this.player.speed = 0.1;
        this.player.isJumping = false;
        this.player.isSprinting = false;
    }
    
    // 角色外觀：臉部使用真人照片貼圖（face.png），其餘為黑髮、黑色上衣、手錶
    buildPlayerAvatar() {
        const P = this.player;
        const avatar = new THREE.Group();
        P.add(avatar);
        this.playerAnimation.avatar = avatar;
        const mat = (c, r = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
        const skin = mat(0xc29b84, 0.7), hairM = mat(0x131110, 0.9);
        const add = (mesh, x, y, z, parent = avatar) => { mesh.position.set(x, y, z); parent.add(mesh); return mesh; };
        const SX = 0.9, SY = 1.25, SZ = 0.95, R = 0.4, HY = 1.38;

        add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.3, 10), skin), 0, 0.98, 0);

        // 頭（用群組整體縮放成偏長的臉型）
        const headG = new THREE.Group();
        headG.scale.set(SX, SY, SZ);
        headG.position.set(0, HY, 0);
        avatar.add(headG);
        const head = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 24), skin);
        head.castShadow = true;
        headG.add(head);

        // 後腦與兩側的黑色短髮（前半部由照片提供）
        const hair = new THREE.Mesh(
            new THREE.SphereGeometry(R * 1.025, 32, 20, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, 1.85), hairM);
        headG.add(hair);

        // 臉部照片：把前半球的 UV 改成「平面投影」，照片就會貼合頭型
        const patchGeo = new THREE.SphereGeometry(R * 1.008, 40, 32, Math.PI / 2 - 1.05, 2.1, 0.02, 2.95);
        const pos = patchGeo.attributes.position, uv = patchGeo.attributes.uv;
        const IMG_W = 1.166, IMG_H = 1.372, U0 = 0.494, V0 = 0.533;   // 由照片比例換算
        for (let k = 0; k < pos.count; k++) {
            uv.setXY(k, U0 + (pos.getX(k) * SX) / IMG_W, V0 + (pos.getY(k) * SY) / IMG_H);
        }
        uv.needsUpdate = true;
        const faceMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
        const patch = new THREE.Mesh(patchGeo, faceMat);
        patch.renderOrder = 2;
        headG.add(patch);
        new THREE.TextureLoader().load('face.png', (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = 8;
            faceMat.map = tex; faceMat.needsUpdate = true;
        }, undefined, () => console.warn('face.png 載入失敗，請確認它和 index.html 放在同一個資料夾'));

        // 耳朵
        for (const sx of [1, -1]) {
            const ear = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), skin);
            ear.scale.set(0.45, 1.2, 0.8);
            add(ear, sx * 0.372, HY - 0.05, -0.01);
        }

        // 黑色短袖：手臂（肩下一小段袖子 + 手臂皮膚）
        for (const sx of [1, -1]) {
            const arm = new THREE.Group();
            arm.position.set(sx * 0.62, 0.62, 0);
            avatar.add(arm);
            this.playerAnimation.arms.push({ mesh: arm, side: sx });
            add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.12, 0.34, 10), mat(0x141414, 0.7)), 0, 0, 0, arm);
            add(new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.085, 0.62, 10), skin), 0, -0.48, 0, arm);
            add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), skin), 0, -0.82, 0, arm);
            const leg = new THREE.Group();
            leg.position.set(sx * 0.2, -0.24, 0);
            avatar.add(leg);
            this.playerAnimation.legs.push({ mesh: leg, side: sx });
            add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.75, 10), mat(0x171717, 0.85)), 0, -0.35, 0, leg);
            add(new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.16, 0.4), mat(0x242424, 0.8)), 0, -0.74, 0.08, leg);
        }
        // 左手腕（角色的左邊 = +x）銀色手錶
        const watch = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.07, 14), mat(0xc9ccd1, 0.25));
        watch.material.metalness = 0.8;
        add(watch, 0, -0.7, 0, this.playerAnimation.arms[0].mesh);

        // 胸前白色「中中」圖樣（左胸 = +x；八角柱正面刻面法線偏 22.5°）
        const cv = document.createElement('canvas'); cv.width = cv.height = 128;
        const g = cv.getContext('2d');
        g.fillStyle = '#ffffff'; g.font = 'bold 56px "Microsoft JhengHei","PingFang TC",sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('中', 36, 64); g.fillText('中', 92, 64);
        const print = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }));
        const a = Math.PI / 8, d = 0.5 * Math.cos(a) + 0.004;
        print.position.set(Math.sin(a) * d, 0.5, Math.cos(a) * d);
        print.rotation.y = a;
        avatar.add(print);
    }

    updatePlayerAnimation(delta, moving, running) {
        const animation = this.playerAnimation;
        const amplitude = moving ? (running ? 0.72 : 0.45) : 0;
        if (moving) animation.phase += delta * (running ? 13 : 8);
        const cycle = Math.sin(animation.phase);
        for (const arm of animation.arms) {
            arm.mesh.rotation.x += (-arm.side * cycle * amplitude - arm.mesh.rotation.x) * Math.min(1, 12 * delta);
        }
        for (const leg of animation.legs) {
            leg.mesh.rotation.x += (leg.side * cycle * amplitude - leg.mesh.rotation.x) * Math.min(1, 12 * delta);
        }
        const bob = moving ? Math.abs(Math.sin(animation.phase * 2)) * (running ? 0.035 : 0.02) : 0;
        animation.avatar.position.y += (bob - animation.avatar.position.y) * Math.min(1, 14 * delta);
    }

    setupBuildings() {
        this.createMappedCampus();
        this.createMainGate();
        this.createRudeGate();
        this.createCampusGates();
        this.createCampusWalls();
        this.createCampusDetails();
        this.prepareBuildings();
        this.minorViolationZones = [
            { name: '校門口', position: this.projectMapPoint(120.68622, 24.14943), radius: 9 },
            { name: '穿堂', position: this.projectMapPoint(120.68645, 24.15012), radius: 7 }
        ];
        this.propertyDamageZones = [
            { name: '容光華園花圃', position: this.projectMapPoint(120.6858, 24.14955), radius: 5 },
            { name: '光中亭周圍花圃', position: this.projectMapPoint(120.68754, 24.1503), radius: 5 }
        ];
        this.createVehicles();
    }

    createVehicles() {
        const materials = {
            frame: new THREE.MeshStandardMaterial({ color: 0x263b4b, metalness: 0.55, roughness: 0.4 }),
            tire: new THREE.MeshStandardMaterial({ color: 0x171717, roughness: 0.85 }),
            metal: new THREE.MeshStandardMaterial({ color: 0xb8c1c8, metalness: 0.75, roughness: 0.3 }),
            glass: new THREE.MeshStandardMaterial({ color: 0x87c9d9, metalness: 0.15, roughness: 0.2, transparent: true, opacity: 0.7 })
        };
        const addBar = (group, start, end, radius, material) => {
            const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
            const direction = new THREE.Vector3().subVectors(b, a);
            const bar = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 8), material);
            bar.position.copy(a).add(b).multiplyScalar(0.5);
            bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
            group.add(bar);
        };
        const addWheel = (group, x, z, radius, material) => {
            const wheel = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.09, 8, 20), material);
            wheel.position.set(x, radius, z);
            wheel.rotation.y = Math.PI / 2;
            group.add(wheel);
        };
        const buildBicycle = () => {
            const group = new THREE.Group();
            const frame = materials.frame;
            addWheel(group, 0, -0.78, 0.42, materials.tire);
            addWheel(group, 0, 0.78, 0.42, materials.tire);
            addBar(group, [0, 0.42, -0.78], [0, 0.94, -0.18], 0.045, frame);
            addBar(group, [0, 0.42, 0.78], [0, 0.94, -0.18], 0.045, frame);
            addBar(group, [0, 0.94, -0.18], [0, 0.5, 0.08], 0.045, frame);
            addBar(group, [0, 0.5, 0.08], [0, 0.42, -0.78], 0.045, frame);
            addBar(group, [0, 0.5, 0.08], [0, 0.94, 0.58], 0.04, materials.metal);
            addBar(group, [-0.25, 0.98, -0.18], [0.25, 0.98, -0.18], 0.07, frame);
            const wrapper = new THREE.Group();   // 車頭轉成朝 +z（與角色前進方向一致）
            group.rotation.y = Math.PI;
            wrapper.add(group);
            return wrapper;
        };
        const buildMotorcycle = () => {
            const group = new THREE.Group();
            addWheel(group, 0, -0.95, 0.48, materials.tire);
            addWheel(group, 0, 0.95, 0.48, materials.tire);
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.48, 1.35), materials.frame);
            body.position.set(0, 0.92, 0);
            group.add(body);
            const seat = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.16, 0.78), materials.tire);
            seat.position.set(0, 1.22, -0.1);
            group.add(seat);
            addBar(group, [0, 0.85, 0.35], [0, 1.42, 0.75], 0.045, materials.metal);
            addBar(group, [-0.45, 1.42, 0.75], [0.45, 1.42, 0.75], 0.045, materials.metal);
            return group;
        };
        const buildCar = () => {
            const group = new THREE.Group();
            const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xa83434, metalness: 0.35, roughness: 0.4 });
            const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.65, 3.7), bodyMaterial);
            body.position.y = 0.68;
            group.add(body);
            const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.75, 1.85), materials.glass);
            cabin.position.set(0, 1.3, -0.15);
            group.add(cabin);
            for (const x of [-1, 1]) {
                for (const z of [-1.2, 1.2]) {
                    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.2, 16), materials.tire);
                    wheel.position.set(x, 0.42, z);
                    wheel.rotation.z = Math.PI / 2;
                    group.add(wheel);
                }
            }
            return group;
        };
        this.buildMotorcycleModel = buildMotorcycle;
        // 讓肩膀處的手臂樞軸指向把手（必要時拉長手臂），避免手垂在身體兩側
        const aimArm = (pivot, targetWorld, naturalLength) => {
            pivot.parent.updateWorldMatrix(true, false);
            const dir = pivot.parent.worldToLocal(targetWorld.clone()).sub(pivot.position);
            const length = dir.length();
            pivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
            pivot.scale.set(1, Math.min(2, Math.max(0.6, length / naturalLength)), 1);
        };
        this.aimArm = aimArm;
        const pantsMaterial = new THREE.MeshStandardMaterial({ color: 0x24282d, roughness: 0.85 });
        // 坐姿：身體前傾、手握把手、腿折起來踩踏板
        const createSeatedRider = (mesh, pose) => {
            const rider = new THREE.Group();
            const lean = new THREE.Group();
            lean.position.set(0, pose.hipY, pose.hipZ);
            lean.scale.setScalar(pose.scale);
            lean.rotation.x = pose.lean;
            rider.add(lean);
            const body = this.player.clone(true);
            body.position.set(0, 0.9, 0);      // 圓柱身體底端剛好在髖部
            body.rotation.set(0, 0, 0);
            body.scale.setScalar(1);
            lean.add(body);
            const head = body.children.find(child => child.isGroup);
            if (head) head.rotation.x = -pose.lean * 0.75;   // 抬頭看前方
            const arms = [];
            for (const side of [1, -1]) {
                const pivot = new THREE.Group();
                pivot.position.set(side * 0.62, 0.75, 0);
                body.add(pivot);
                for (const part of body.children.slice()) {
                    if (part !== pivot && Math.abs(part.position.x - side * 0.62) < 0.01 && part.position.y < 0.8) {
                        part.position.y -= 0.75;
                        part.position.x = 0;
                        pivot.add(part);
                    }
                }
                arms.push({ pivot, side });
            }
            for (const side of [1, -1]) {
                const hip = new THREE.Vector3(side * 0.2, pose.hipY, pose.hipZ);
                const knee = new THREE.Vector3(side * pose.legSpread, pose.kneeY, pose.kneeZ);
                const foot = new THREE.Vector3(side * pose.legSpread, pose.footY, pose.footZ);
                for (const [a, b] of [[hip, knee], [knee, foot]]) {
                    const direction = new THREE.Vector3().subVectors(b, a);
                    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.1, direction.length(), 8), pantsMaterial);
                    leg.position.copy(a).add(b).multiplyScalar(0.5);
                    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
                    rider.add(leg);
                }
                const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.32), materials.tire);
                shoe.position.set(side * pose.legSpread, pose.footY, pose.footZ + 0.08);
                rider.add(shoe);
            }
            mesh.add(rider);
            mesh.updateMatrixWorld(true);
            for (const { pivot, side } of arms) {
                aimArm(pivot, mesh.localToWorld(new THREE.Vector3(side * pose.handX, pose.handY, pose.handZ)), 0.95);
            }
            return rider;
        };
        this.seatedPoses = {
            motorcycle: { hipY: 1.3, hipZ: -0.05, scale: 0.46, lean: 0.5, handX: 0.42, handY: 1.42, handZ: 0.75,
                          legSpread: 0.38, kneeY: 1.2, kneeZ: 0.5, footY: 0.55, footZ: 0.1 },
            bicycle: { hipY: 1.02, hipZ: -0.55, scale: 0.42, lean: 0.6, handX: 0.25, handY: 0.98, handZ: 0.18,
                       legSpread: 0.2, kneeY: 0.95, kneeZ: -0.05, footY: 0.3, footZ: -0.1 }
        };
        this.createSeatedRider = createSeatedRider;
        const definitions = [
            { type: 'bicycle', name: '同學腳踏車', severity: 2, speed: 7.2, acceleration: 3.8, braking: 6, accelerationMultiplier: 1.22, radius: 0.8, mapColor: '#68d2b0', build: buildBicycle, position: this.projectMapPoint(120.68628, 24.14947) },
            { type: 'motorcycle', name: '一般機車', severity: 2, speed: 9, acceleration: 5.2, braking: 7, accelerationMultiplier: 1.18, radius: 1.1, mapColor: '#ffc857', build: buildMotorcycle, position: this.projectMapPoint(120.68662, 24.15030) },
            { type: 'car', name: '汽車', severity: 2, speed: 11.5, acceleration: 4.2, braking: 6, accelerationMultiplier: 1.12, radius: 1.7, mapColor: '#ed6a5a', build: buildCar, position: this.projectMapPoint(120.68732, 24.15093) },
            { type: 'instructorMotorcycle', name: '教官公務機車', severity: 3, speed: 10.5, acceleration: 5.2, braking: 7, accelerationMultiplier: 1.18, radius: 1.1, mapColor: '#f0e5d1', build: buildMotorcycle, position: this.projectMapPoint(120.68739, 24.14986) }
        ];
        for (const definition of definitions) {
            const mesh = definition.build();
            mesh.position.set(definition.position.x, 0, definition.position.z);
            mesh.rotation.y = Math.PI;
            this.scene.add(mesh);
            let rider;
            if (this.seatedPoses[definition.type]) {
                rider = createSeatedRider(mesh, this.seatedPoses[definition.type]);
            } else {
                rider = this.player.clone(true);
                rider.position.set(0, 0.66, 0);
                rider.scale.setScalar(this.playerScale * 0.82);
                mesh.add(rider);
            }
            rider.visible = false;
            mesh.traverse(part => { if (part.isMesh) part.castShadow = true; });
            this.vehicles.push({ ...definition, mesh, rider, stolen: false });
        }
    }

    reportVehicleTheft(vehicle) {
        if (!vehicle.stolen) {
            vehicle.stolen = true;
            const event = vehicle.type === 'instructorMotorcycle'
                ? '搶走教官公務機車（最高警戒）'
                : `搶走${vehicle.name}`;
            this.reportViolation(vehicle.severity, event);
        }
    }

    reportViolation(level, reason) {
        const nextLevel = Math.min(this.maxWantedLevel, Math.max(this.wantedLevel, level));
        if (nextLevel === this.wantedLevel) return;
        this.wantedLevel = nextLevel;
        this.wantedEscapeTime = 0;
        this.wantedElapsed = 0;
        this.wantedLastSeen = { x: this.player.position.x, z: this.player.position.z };
        this.wantedCenter = { ...this.wantedLastSeen };
        this.wantedRadius = [0, 8, 15, this.maxWantedRadius][this.wantedLevel];
        this.whistlePlayed = this.wantedLevel === 1;
        this.clearInstructorUnits();
        this.createInstructors();
        this.createWantedRing();
        if (this.wantedLevel === 3) this.createWantedRoadblocks();
        this.showToast(this.wantedLevel === 1
            ? `嗶——教官吹哨警告：${reason}（1 星）`
            : `${reason}，教官已收到通報（${'★'.repeat(this.wantedLevel)}）`);
        this.updateWantedStatus();
    }

    checkMinorVehicleViolation() {
        if (!this.currentVehicle) return;
        const position = this.player.position;
        const damagedGarden = this.propertyDamageZones.find(area =>
            Math.hypot(position.x - area.position.x, position.z - area.position.z) <= 1.6 + this.currentVehicle.radius * 0.5
        );
        if (damagedGarden && this.currentVehicle.type !== 'instructorMotorcycle' &&
            this.wantedLevel < 3) {
            this.reportViolation(3, `撞翻${damagedGarden.name}`);
            return;
        }
        if (this.wantedLevel) return;
        const zone = this.minorViolationZones.find(area =>
            Math.hypot(position.x - area.position.x, position.z - area.position.z) <= area.radius
        );
        const zoneName = zone ? zone.name : null;
        if (zoneName && zoneName !== this.lastVehicleViolationZone) {
            this.lastVehicleViolationZone = zoneName;
            this.reportViolation(1, `在${zoneName}違規騎車`);
        } else if (!zoneName) {
            this.lastVehicleViolationZone = null;
        }
    }

    createInstructors() {
        const shirt = new THREE.MeshStandardMaterial({ color: 0x283e58, roughness: 0.75 });
        const trousers = new THREE.MeshStandardMaterial({ color: 0x24282d, roughness: 0.85 });
        const skin = new THREE.MeshStandardMaterial({ color: 0xc99d7b, roughness: 0.8 });
        const helmet = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 });
        const config = this.wantedLevel === 1
            ? { count: 1, sightRadius: 8, sightAngle: Math.PI / 3, footSpeed: 4.4, bikeSpeed: 0 }
            : this.wantedLevel === 2
                ? { count: 3, sightRadius: 15, sightAngle: Math.PI * 0.62, footSpeed: 6.2, bikeSpeed: 8 }
                : { count: 5, sightRadius: this.maxWantedRadius, sightAngle: Math.PI * 0.9, footSpeed: 7.2, bikeSpeed: 8.2 };
        for (let index = 0; index < config.count; index++) {
            const useMotorcycle = this.wantedLevel === 2
                ? index === 0
                : this.wantedLevel === 3 && index < 4;
            const unit = new THREE.Group();
            const patrolLights = [];
            if (useMotorcycle) {
                unit.add(this.buildMotorcycleModel());
                for (const [side, color] of [[-1, 0xff3030], [1, 0x3986ff]]) {
                    const light = new THREE.Mesh(
                        new THREE.SphereGeometry(0.12, 10, 8),
                        new THREE.MeshBasicMaterial({ color })
                    );
                    light.position.set(side * 0.2, 1.48, 0.8);
                    unit.add(light);
                    patrolLights.push(light);
                }
            }
            const rider = new THREE.Group();
            if (useMotorcycle) {
                rider.scale.setScalar(0.6);
                rider.position.set(0, 0.84, -0.05);
                rider.rotation.x = 0.2;
                unit.add(rider);
            } else {
                unit.add(rider);
            }
            const torso = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.95, 0.4), shirt);
            torso.position.y = 1.18;
            rider.add(torso);
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 16, 12), skin);
            head.position.y = 1.88;
            rider.add(head);
            const cap = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), helmet);
            cap.position.y = 1.9;
            rider.add(cap);
            const tie = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.06), new THREE.MeshStandardMaterial({ color: 0xc64242 }));
            tie.position.set(0, 1.38, 0.22);
            rider.add(tie);
            const arms = [];
            const legs = [];
            for (const side of [-1, 1]) {
                const pivot = new THREE.Group();
                pivot.position.set(side * 0.48, useMotorcycle ? 1.55 : 1.55, 0);
                const arm = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.78, 0.22), shirt);
                arm.position.y = -0.39;
                pivot.add(arm);
                rider.add(pivot);
                arms.push({ pivot, side });
                const legPivot = new THREE.Group();
                legPivot.position.set(side * 0.2, 0.78, 0);
                const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.78, 0.28), trousers);
                leg.position.y = -0.39;
                legPivot.add(leg);
                rider.add(legPivot);
                legs.push({ pivot: legPivot, side });
            }
            const angle = Math.PI * 2 * index / config.count + 0.35;
            const distance = this.wantedLevel === 1 ? 10 : 13 + (index % 2) * 5;
            unit.position.set(this.wantedCenter.x + Math.sin(angle) * distance, 0, this.wantedCenter.z + Math.cos(angle) * distance);
            this.resolveCollisions(unit.position, false);
            unit.rotation.y = Math.atan2(this.wantedCenter.x - unit.position.x, this.wantedCenter.z - unit.position.z);
            this.scene.add(unit);
            unit.updateMatrixWorld(true);
            if (useMotorcycle) {
                for (const { pivot, side } of arms) {
                    this.aimArm(pivot, unit.localToWorld(new THREE.Vector3(side * 0.42, 1.42, 0.75)), 0.78);
                }
            }
            const coneShape = new THREE.Shape();
            coneShape.moveTo(0, 0);
            const halfAngle = config.sightAngle / 2;
            const segments = 28;
            for (let step = 0; step <= segments; step++) {
                const angleOnCone = -halfAngle + config.sightAngle * step / segments;
                coneShape.lineTo(
                    Math.sin(angleOnCone) * config.sightRadius,
                    -Math.cos(angleOnCone) * config.sightRadius
                );
            }
            coneShape.closePath();
            const cone = new THREE.Mesh(
                new THREE.ShapeGeometry(coneShape),
                new THREE.MeshBasicMaterial({ color: 0xf02c38, transparent: true, opacity: this.wantedLevel === 3 ? 0.16 : 0.22, side: THREE.DoubleSide, depthWrite: false })
            );
            cone.rotation.x = -Math.PI / 2;
            cone.position.y = 0.035;
            cone.renderOrder = 2;
            unit.add(cone);
            unit.traverse(part => { if (part.isMesh) part.castShadow = true; });
            this.instructors.push({
                mesh: unit,
                speed: 0,
                sightRadius: config.sightRadius,
                sightAngle: config.sightAngle,
                footSpeed: config.footSpeed,
                bikeSpeed: config.bikeSpeed,
                useMotorcycle,
                patrolLights,
                legs,
                patrolPhase: angle,
                pursuitRamp: 0
            });
        }
    }

    clearInstructorUnits() {
        for (const instructor of this.instructors) this.scene.remove(instructor.mesh);
        this.instructors = [];
        for (const blocker of this.wantedRoadblocks) this.scene.remove(blocker);
        this.wantedRoadblocks = [];
        this.wantedRoadblockColliders = [];
    }

    createWantedRoadblocks() {
        const locations = [
            this.projectMapPoint(120.687421, 24.14986),
            this.projectMapPoint(120.68642, 24.15015),
            this.projectMapPoint(120.68754, 24.1503)
        ];
        const barrierMaterial = new THREE.MeshStandardMaterial({ color: 0xd83b36, roughness: 0.6 });
        const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0xf4eee3, roughness: 0.7 });
        for (const [index, position] of locations.entries()) {
            const barrier = new THREE.Group();
            const beam = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.28, 0.35), barrierMaterial);
            beam.position.y = 0.9;
            barrier.add(beam);
            const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.1, 0.37), stripeMaterial);
            stripe.position.set(0, 0.9, 0.02);
            stripe.rotation.z = -0.12;
            barrier.add(stripe);
            for (const side of [-1, 1]) {
                const foot = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.72, 0.28), barrierMaterial);
                foot.position.set(side * 2.1, 0.36, 0);
                barrier.add(foot);
                const lamp = new THREE.Mesh(
                    new THREE.SphereGeometry(0.18, 12, 8),
                    new THREE.MeshBasicMaterial({ color: index % 2 ? 0x3986ff : 0xff3333 })
                );
                lamp.position.set(side * 2.2, 1.24, 0);
                barrier.add(lamp);
            }
            barrier.position.set(position.x, 0, position.z);
            barrier.rotation.y = index === 1 ? Math.PI / 2 : 0;
            barrier.traverse(part => { if (part.isMesh) part.castShadow = true; });
            this.scene.add(barrier);
            this.wantedRoadblocks.push(barrier);
            this.wantedRoadblockColliders.push({
                x: position.x,
                z: position.z,
                rotation: barrier.rotation.y,
                halfLength: 2.6,
                halfWidth: 0.22
            });
        }
    }

    createWantedRing() {
        if (this.wantedRing) this.scene.remove(this.wantedRing);
        const ring = new THREE.Group();
        const fill = new THREE.Mesh(
            new THREE.CircleGeometry(this.wantedRadius, 96),
            new THREE.MeshBasicMaterial({ color: 0xf02c38, transparent: true, opacity: 0.045, depthWrite: false })
        );
        fill.rotation.x = -Math.PI / 2;
        fill.position.y = 0.025;
        ring.add(fill);
        const edge = new THREE.Mesh(
            new THREE.RingGeometry(Math.max(0, this.wantedRadius - 0.18), this.wantedRadius, 96),
            new THREE.MeshBasicMaterial({ color: 0xf02c38, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false })
        );
        edge.rotation.x = -Math.PI / 2;
        edge.position.y = 0.04;
        ring.add(edge);
        ring.position.set(this.wantedCenter.x, 0, this.wantedCenter.z);
        ring.renderOrder = 3;
        this.scene.add(ring);
        this.wantedRing = ring;
    }

    isPlayerConcealed() {
        if (this.currentVehicle) return false;
        const player = this.player.position;
        return this.coverZones.some(zone => Math.hypot(player.x - zone.x, player.z - zone.z) < zone.radius);
    }

    isSightBlocked(start, end) {
        const dx = end.x - start.x, dz = end.z - start.z;
        const length = Math.hypot(dx, dz);
        const steps = Math.ceil(length / 1.5);
        for (let step = 1; step < steps; step++) {
            const ratio = step / steps;
            const x = start.x + dx * ratio, z = start.z + dz * ratio;
            if (this.solids.some(building => building.footprint && this.isPointInPolygon(x, z, building.footprint))) return true;
        }
        return false;
    }

    isInstructorSeeingPlayer(instructor) {
        const player = this.player.position, origin = instructor.mesh.position;
        const dx = player.x - origin.x, dz = player.z - origin.z;
        const distance = Math.hypot(dx, dz);
        if (distance > instructor.sightRadius || this.isPlayerConcealed()) return false;
        const facing = { x: Math.sin(instructor.mesh.rotation.y), z: Math.cos(instructor.mesh.rotation.y) };
        const dot = (facing.x * dx + facing.z * dz) / (distance || 1);
        if (dot < Math.cos(instructor.sightAngle / 2)) return false;
        return !this.isSightBlocked(origin, player);
    }

    createPedestrians() {
        const colors = [0x547c99, 0x8a5c73, 0x75804e, 0x9a7048];
        for (const path of this.planPaths) {
            const route = path.points.filter(point =>
                this.isPointInPolygon(point.x, point.z, this.campusBoundary) &&
                !this.solids.some(building => building.footprint && this.isPointInPolygon(point.x, point.z, building.footprint))
            );
            if (route.length < 3) continue;
            for (const routeIndex of [1, route.length - 2]) {
                const mesh = new THREE.Group();
                const shirt = new THREE.MeshStandardMaterial({ color: colors[this.pedestrians.length % colors.length], roughness: 0.8 });
                const pants = new THREE.MeshStandardMaterial({ color: 0x34383d, roughness: 0.9 });
                const skin = new THREE.MeshStandardMaterial({ color: 0xc99d7b, roughness: 0.8 });
                const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.72, 0.3), shirt);
                torso.position.y = 1.05;
                mesh.add(torso);
                const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), skin);
                head.position.y = 1.55;
                mesh.add(head);
                for (const side of [-1, 1]) {
                    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.62, 0.2), pants);
                    leg.position.set(side * 0.14, 0.36, 0);
                    mesh.add(leg);
                }
                const start = route[routeIndex];
                mesh.position.set(start.x, 0, start.z);
                this.scene.add(mesh);
                this.pedestrians.push({ mesh, route, routeIndex, direction: routeIndex === 1 ? 1 : -1, speed: 1.05, knockedDown: false });
            }
        }
    }

    updatePedestrians(delta) {
        for (const pedestrian of this.pedestrians) {
            if (pedestrian.knockedDown) continue;
            const target = pedestrian.route[pedestrian.routeIndex];
            const dx = target.x - pedestrian.mesh.position.x, dz = target.z - pedestrian.mesh.position.z;
            const distance = Math.hypot(dx, dz);
            if (distance > 0.15) {
                const step = Math.min(distance, pedestrian.speed * delta);
                pedestrian.mesh.position.x += dx / distance * step;
                pedestrian.mesh.position.z += dz / distance * step;
                pedestrian.mesh.rotation.y = Math.atan2(dx, dz);
            } else {
                pedestrian.routeIndex += pedestrian.direction;
                if (pedestrian.routeIndex <= 0 || pedestrian.routeIndex >= pedestrian.route.length - 1) {
                    pedestrian.direction *= -1;
                    pedestrian.routeIndex = Math.max(1, Math.min(pedestrian.route.length - 2, pedestrian.routeIndex));
                }
            }
            if (!this.currentVehicle) continue;
            const gap = Math.hypot(
                this.player.position.x - pedestrian.mesh.position.x,
                this.player.position.z - pedestrian.mesh.position.z
            );
            if (gap < this.currentVehicle.radius + 0.65) {
                pedestrian.knockedDown = true;
                pedestrian.mesh.rotation.x = Math.PI / 2;
                pedestrian.mesh.position.y = 0.05;
                this.reportViolation(2, '撞倒路人');
            }
        }
    }

    updateWantedStatus() {
        const status = document.getElementById('wanted-status');
        if (!status) return;
        if (!this.wantedLevel) {
            status.classList.add('hidden');
            return;
        }
        status.classList.remove('hidden');
        const escapedSeconds = Math.min(5, Math.floor(this.wantedEscapeTime));
        const approachText = this.wantedElapsed < 3
            ? `教官逼近倒數 ${Math.ceil(3 - this.wantedElapsed)} 秒`
            : '教官正在逼近';
        const labels = ['', '小跑教官 x1', '包抄教官 x3', '機車巡邏隊 x5／路口封鎖'];
        status.textContent = `教官通報 ${'★'.repeat(this.wantedLevel)}　${labels[this.wantedLevel]}　${approachText}　圈外 ${escapedSeconds}/5 秒`;
    }

    clearWanted() {
        this.wantedLevel = 0;
        this.wantedRadius = 0;
        this.wantedCenter = null;
        this.wantedEscapeTime = 0;
        this.wantedElapsed = 0;
        this.isExploringOutsideCampus = this.campusBoundary &&
            !this.isPointInPolygon(this.player.position.x, this.player.position.z, this.campusBoundary);
        if (this.wantedRing) {
            this.scene.remove(this.wantedRing);
            this.wantedRing = null;
        }
        this.clearInstructorUnits();
        this.wantedLastSeen = null;
        this.updateWantedStatus();
        this.showToast('已脫離教官追捕！');
    }

    updateWanted(delta) {
        if (!this.wantedLevel) return;
        const player = this.player.position;
        this.wantedElapsed = (this.wantedElapsed || 0) + delta;
        const concealed = this.isPlayerConcealed();
        let spotted = false;
        for (const instructor of this.instructors) {
            const position = instructor.mesh.position;
            const dx = player.x - position.x, dz = player.z - position.z;
            const distance = Math.hypot(dx, dz);
            if (!concealed && distance <= instructor.sightRadius && this.isInstructorSeeingPlayer(instructor)) {
                spotted = true;
                this.wantedLastSeen = { x: player.x, z: player.z };
                instructor.mesh.rotation.y = Math.atan2(dx, dz);
            }
        }
        const outsideAlertArea = Math.hypot(player.x - this.wantedCenter.x, player.z - this.wantedCenter.z) > this.wantedRadius;
        if (!spotted && outsideAlertArea) this.wantedEscapeTime += delta;
        else this.wantedEscapeTime = 0;

        let caught = false;
        const pursuitWarmup = 3;
        const pursuitRamp = Math.min(1, Math.max(0, this.wantedElapsed - pursuitWarmup) / 4);
        const smoothRamp = pursuitRamp * pursuitRamp * (3 - 2 * pursuitRamp);
        for (const instructor of this.instructors) {
            const position = instructor.mesh.position;
            const target = this.wantedLastSeen || this.wantedCenter;
            const dx = target.x - position.x, dz = target.z - position.z;
            const distance = Math.hypot(dx, dz);
            const topSpeed = instructor.useMotorcycle ? instructor.bikeSpeed : instructor.footSpeed;
            const targetSpeed = topSpeed * smoothRamp;
            instructor.speed += (targetSpeed - instructor.speed) * Math.min(1, 2.5 * delta);
            if (instructor.patrolLights.length) {
                instructor.patrolLights[0].visible = Math.sin(this.wantedElapsed * 12) >= 0;
                instructor.patrolLights[1].visible = Math.sin(this.wantedElapsed * 12) < 0;
            }
            if (this.wantedElapsed >= pursuitWarmup && distance > 2.5) {
                const step = Math.min(distance - 2.5, instructor.speed * delta);
                position.x += dx / distance * step;
                position.z += dz / distance * step;
                if (spotted) {
                    let diff = Math.atan2(dx, dz) - instructor.mesh.rotation.y;
                    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
                    instructor.mesh.rotation.y += diff * Math.min(1, 6 * delta);
                } else {
                    instructor.patrolPhase += delta * 0.12;
                    instructor.mesh.rotation.y = Math.atan2(dx, dz) + Math.sin(instructor.patrolPhase) * 0.2;
                }
                this.resolveCollisions(position, false);
                for (const leg of instructor.legs) {
                    leg.pivot.rotation.x = Math.sin(this.wantedElapsed * 10 + leg.side * Math.PI) * (instructor.useMotorcycle ? 0.08 : 0.48);
                }
            } else if (this.wantedElapsed >= pursuitWarmup && spotted) {
                caught = true;
            }
        }
        if (caught) {
            this.onCaughtByInstructor();
            return;
        }
        this.updateWantedStatus();
        if (this.wantedEscapeTime >= 5) this.clearWanted();
    }

    // 被教官追上：輕微處理 —— 強制下車、解除通緝，沒有其他懲罰
    onCaughtByInstructor() {
        if (this.currentVehicle) this.interactWithVehicle();
        this.clearWanted();
        this.showToast('被教官抓到了！下次不要亂騎車喔 😅');
    }

    interactWithVehicle() {
        const vehicleButton = document.getElementById('vehicle-btn');
        const sprintButton = document.getElementById('sprint-btn');
        if (this.currentVehicle) {
            const vehicle = this.currentVehicle;
            vehicle.mesh.position.set(this.player.position.x, 0, this.player.position.z);
            vehicle.mesh.rotation.y = this.player.rotation.y;
            vehicle.rider.visible = false;
            this.player.visible = true;
            this.playerRadius = 0.45;
            this.currentVehicle = null;
            this.currentSpeed = 0;
            if (vehicleButton) vehicleButton.textContent = '騎乘';
            if (sprintButton) sprintButton.textContent = '奔跑';
            this.showToast('已下車');
            return;
        }
        let nearest = null, nearestDistance = 5;
        for (const vehicle of this.vehicles) {
            const distance = Math.hypot(
                this.player.position.x - vehicle.mesh.position.x,
                this.player.position.z - vehicle.mesh.position.z
            );
            if (distance < nearestDistance) {
                nearest = vehicle;
                nearestDistance = distance;
            }
        }
        if (!nearest) {
            this.showToast('靠近腳踏車、機車或汽車再按 E');
            return;
        }
        this.currentVehicle = nearest;
        nearest.currentSpeed = 0;
        this.currentSpeed = 0;
        this.player.position.x = nearest.mesh.position.x;
        this.player.position.z = nearest.mesh.position.z;
        this.player.position.y = this.playerGround;
        this.player.velocity.y = 0;
        this.player.isJumping = false;
        this.playerRadius = nearest.radius;
        this.player.visible = false;
        nearest.rider.visible = true;
        if (vehicleButton) vehicleButton.textContent = '下車';
        if (sprintButton) sprintButton.textContent = '加速';
        this.reportVehicleTheft(nearest);
    }

    projectMapPoint(lon, lat) {
        const originLon = 120.68662;
        const originLat = 24.1505;
        const metersPerDegreeLon = 111320 * Math.cos(originLat * Math.PI / 180);
        const east = (lon - originLon) * metersPerDegreeLon;
        const north = (lat - originLat) * 111320;
        const gateToCampusEast = (originLon - 120.6862) * metersPerDegreeLon;
        const gateToCampusNorth = (originLat - 24.1493) * 111320;
        const heading = -Math.atan2(gateToCampusEast, gateToCampusNorth);
        return {
            x: -(east * Math.cos(heading) + north * Math.sin(heading)),
            z: -east * Math.sin(heading) + north * Math.cos(heading)
        };
    }

    createMapShape(points, material, y = 0.03) {
        const shape = new THREE.Shape();
        points.forEach(([lon, lat], index) => {
            const point = this.projectMapPoint(lon, lat);
            const shapeY = -point.z;
            if (index === 0) shape.moveTo(point.x, shapeY);
            else shape.lineTo(point.x, shapeY);
        });
        shape.closePath();
        const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = y;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.planSurfaces.push({
            points: points.map(([lon, lat]) => this.projectMapPoint(lon, lat)),
            color: `#${material.color.getHexString()}`
        });
        return mesh;
    }

    createMapPath(points, width, material) {
        const projected = points.map(([lon, lat]) => this.projectMapPoint(lon, lat));
        const vertices = [];
        const indices = [];
        projected.forEach((point, index) => {
            const previous = projected[Math.max(0, index - 1)];
            const next = projected[Math.min(projected.length - 1, index + 1)];
            const dx = next.x - previous.x;
            const dz = next.z - previous.z;
            const length = Math.hypot(dx, dz) || 1;
            const offsetX = -dz / length * width / 2;
            const offsetZ = dx / length * width / 2;
            vertices.push(point.x + offsetX, 0.055, point.z + offsetZ);
            vertices.push(point.x - offsetX, 0.055, point.z - offsetZ);
            if (index > 0) {
                const start = index * 2;
                indices.push(start - 2, start - 1, start, start - 1, start + 1, start);
            }
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        const path = new THREE.Mesh(geometry, material);
        path.receiveShadow = true;
        this.scene.add(path);
        this.planPaths.push({
            points: projected,
            width,
            color: `#${material.color.getHexString()}`
        });
    }

    // =====================================================================
    //  依官網／文化局／維基等「文字資料」補上的校園細節
    //  標示「估計」的位置，查不到精確座標，請對照實地調整
    // =====================================================================

    // 不鏽鋼鏡面用的簡易環境貼圖（沒有它，金屬材質會變黑）
    getMirrorEnv() {
        if (this._mirrorEnv) return this._mirrorEnv;
        const c = document.createElement('canvas');
        c.width = 256; c.height = 128;
        const g = c.getContext('2d');
        const grd = g.createLinearGradient(0, 0, 0, 128);
        grd.addColorStop(0, '#4f8fd0'); grd.addColorStop(0.42, '#eaf4fb');
        grd.addColorStop(0.5, '#a7a79e'); grd.addColorStop(1, '#5f7f4f');
        g.fillStyle = grd; g.fillRect(0, 0, 256, 128);
        g.fillStyle = 'rgba(70,80,75,0.55)';           // 遠處樓房與樹的剪影，讓倒影有點內容
        for (let x = 0; x < 256; x += 22) g.fillRect(x, 64 - 8 - ((x * 7) % 22), 16, 8 + ((x * 7) % 22));
        const tex = new THREE.CanvasTexture(c);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        const pm = new THREE.PMREMGenerator(this.renderer);
        this._mirrorEnv = pm.fromEquirectangular(tex).texture;
        pm.dispose();
        return this._mirrorEnv;
    }

    // 取一組經緯度多邊形的中心與主軸方向
    getPolyFrame(points) {
        const pts = points.map(([lon, lat]) => this.projectMapPoint(lon, lat));
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
        let sxx = 0, szz = 0, sxz = 0;
        for (const p of pts) { const dx = p.x - cx, dz = p.z - cz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
        const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
        const ux = Math.cos(angle), uz = Math.sin(angle);
        let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
        for (const p of pts) {
            const u = (p.x - cx) * ux + (p.z - cz) * uz, v = -(p.x - cx) * uz + (p.z - cz) * ux;
            minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
        }
        return { cx, cz, angle, ux, uz, minU, maxU, minV, maxV };
    }

    createCampusDetails() {
        this.createRongGuangHuaYuan();
        this.createKaresansui();
        this.createClimbingWall();
        this.createCourtyardMound();
        this.createCampusTrees();
    }

    // 容光華園：植物溫室。2015/5 因樟園拆除，由樟園溫室移建到科學館旁（育才街側）
    createRongGuangHuaYuan() {
        const f = this.getPolyFrame([[120.6856647,24.1496808],[120.6859493,24.1495869],[120.6859320,24.1495433],[120.6861745,24.1494633],[120.6861379,24.1493712],[120.6861050,24.1493821],[120.6860891,24.1493420],[120.6853516,24.1495854],[120.6853636,24.1496156],[120.6856070,24.1495353]]);
        const cu = (f.minU + f.maxU) / 2, cv = (f.minV + f.maxV) / 2;
        const px = f.cx + f.ux * cu - f.uz * cv, pz = f.cz + f.uz * cu + f.ux * cv;
        const L = Math.max(8, Math.min(f.maxU - f.minU - 1.5, 14)), Wd = Math.max(3.6, Math.min(f.maxV - f.minV - 1, 6.5));
        const g = new THREE.Group();
        g.position.set(px, 0, pz); g.rotation.y = -f.angle;
        const frame = new THREE.MeshStandardMaterial({ color: 0xf2f4f2, roughness: 0.5, metalness: 0.3 });
        const glass = new THREE.MeshStandardMaterial({ color: 0xbfe6dc, transparent: true, opacity: 0.36, roughness: 0.1, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false });
        const wallH = 2.5, ridge = 4.2, baseH = 0.7;
        const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; g.add(m); return m; };
        add(new THREE.BoxGeometry(L, baseH, Wd), new THREE.MeshStandardMaterial({ color: 0xcfcac0, roughness: 0.9 }), 0, baseH / 2, 0);
        for (const s of [-1, 1]) {
            const wall = new THREE.Mesh(new THREE.PlaneGeometry(L, wallH - baseH), glass);
            wall.position.set(0, baseH + (wallH - baseH) / 2, s * Wd / 2); g.add(wall);
            const sh = new THREE.Shape();
            sh.moveTo(-Wd / 2, baseH); sh.lineTo(Wd / 2, baseH); sh.lineTo(Wd / 2, wallH); sh.lineTo(0, ridge); sh.lineTo(-Wd / 2, wallH); sh.closePath();
            const gable = new THREE.Mesh(new THREE.ShapeGeometry(sh), glass);
            gable.rotation.y = Math.PI / 2; gable.position.set(s * L / 2, 0, 0); g.add(gable);
        }
        const slope = Math.hypot(Wd / 2, ridge - wallH), a = Math.atan2(ridge - wallH, Wd / 2);
        for (const s of [-1, 1]) {
            const roof = new THREE.Mesh(new THREE.PlaneGeometry(L, slope), glass);
            roof.rotation.order = 'YXZ'; roof.rotation.x = -Math.PI / 2 + s * a;
            roof.position.set(0, (wallH + ridge) / 2, s * Wd / 4); g.add(roof);
        }
        add(new THREE.BoxGeometry(L, 0.1, 0.1), frame, 0, ridge, 0);
        const n = Math.round(L / 2);
        for (let i = 0; i <= n; i++) {
            const x = -L / 2 + L * i / n;
            for (const s of [-1, 1]) {
                add(new THREE.BoxGeometry(0.07, wallH - baseH, 0.07), frame, x, baseH + (wallH - baseH) / 2, s * Wd / 2);
                const raf = add(new THREE.BoxGeometry(0.06, 0.06, slope), frame, x, (wallH + ridge) / 2, s * Wd / 4);
                raf.rotation.order = 'YXZ'; raf.rotation.x = s * a;   // 與屋面同向
            }
        }
        add(new THREE.BoxGeometry(L, 0.08, 0.08), frame, 0, wallH, Wd / 2);
        add(new THREE.BoxGeometry(L, 0.08, 0.08), frame, 0, wallH, -Wd / 2);
        // 內部：蕨類與水生植物池
        const rand = this.seededRandom('greenhouse');
        const fern = new THREE.MeshStandardMaterial({ color: 0x3d8f4a, roughness: 0.9 });
        for (let i = 0; i < 16; i++) {
            const m = add(new THREE.SphereGeometry(0.4 + rand() * 0.35, 8, 6), fern, (rand() - 0.5) * (L - 1.5), baseH + 0.2, (rand() - 0.5) * (Wd - 1.2));
            m.scale.y = 0.8 + rand() * 0.8;
        }
        add(new THREE.BoxGeometry(L * 0.28, 0.3, Wd * 0.45), new THREE.MeshStandardMaterial({ color: 0x3b7f93, roughness: 0.25 }), L * 0.28, 0.2, 0);
        for (const s of [-1, 1]) {
            const t = this.textPlane('容光華園', 3.6, 0.5, '#1f5a46', '#f4efe3', 84);
            t.position.set(0, baseH / 2, s * (Wd / 2 + 0.03)); if (s < 0) t.rotation.y = Math.PI; g.add(t);
        }
        this.scene.add(g);
        const fp = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({
            x: px + f.ux * u * L / 2 - f.uz * v * Wd / 2, z: pz + f.uz * u * L / 2 + f.ux * v * Wd / 2
        }));
        this.buildings.push({ mesh: g, name: '容光華園', interactive: true, footprint: fp, mapColor: 0x8fd0bd });
    }

    // 光中亭周圍的枯山水（2015 百年校慶整修）。原址為 1936 年的校內神社，1947 改建光中亭、1976 重建
    createKaresansui() {
        const p = this.projectMapPoint(120.68754, 24.1503);
        const g = new THREE.Group();
        g.position.set(p.x, 0, p.z);
        const bed = new THREE.Mesh(new THREE.PlaneGeometry(13, 13), new THREE.MeshStandardMaterial({ color: 0xdedbd2, roughness: 1 }));
        bed.rotation.x = -Math.PI / 2; bed.position.y = 0.06; bed.receiveShadow = true; g.add(bed);
        const rake = new THREE.MeshStandardMaterial({ color: 0xb8b5ab, roughness: 1 });
        for (const r of [3.4, 4.0, 4.6, 5.2, 5.8]) {
            const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.08, 48), rake);
            ring.rotation.x = -Math.PI / 2; ring.position.y = 0.07; g.add(ring);
        }
        const rock = new THREE.MeshStandardMaterial({ color: 0x6f726f, roughness: 0.95 });
        for (const [x, z, s] of [[-4.6, 3.2, 0.9], [4.8, -2.6, 0.65], [2.2, 5.0, 0.5]]) {
            const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), rock);
            m.scale.y = 0.7; m.position.set(x, s * 0.45, z); m.castShadow = true; g.add(m);
        }
        this.scene.add(g);
    }

    // 磚牆：百年校慶時畢業學長所砌，紀念一中生「翻牆」的不成文習俗；在慎思樓旁、英文科辦公室（景賢樓 1F）邊。位置估計
    createClimbingWall() {
        const c = document.createElement('canvas');
        c.width = 256; c.height = 128;
        const x = c.getContext('2d');
        x.fillStyle = '#a9553f'; x.fillRect(0, 0, 256, 128);
        x.strokeStyle = '#d6c8b0'; x.lineWidth = 2;
        for (let y = 0; y < 128; y += 16) {
            x.beginPath(); x.moveTo(0, y); x.lineTo(256, y); x.stroke();
            for (let bx = (y / 16 % 2) * 20; bx < 256; bx += 40) { x.beginPath(); x.moveTo(bx, y); x.lineTo(bx, y + 16); x.stroke(); }
        }
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(3, 1.5); tex.colorSpace = THREE.SRGBColorSpace;
        const g = new THREE.Group();
        g.position.set(49.5, 0, 4);
        const wall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.4, 6), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
        wall.position.y = 1.2; wall.castShadow = true; g.add(wall);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.15, 6.2), new THREE.MeshStandardMaterial({ color: 0xb5b0a6, roughness: 0.9 }));
        cap.position.y = 2.47; g.add(cap);
        const ec = document.createElement('canvas'); ec.width = ec.height = 128;
        const e = ec.getContext('2d');
        e.fillStyle = '#762f32'; e.beginPath(); e.arc(64, 64, 60, 0, Math.PI * 2); e.fill();
        e.strokeStyle = '#f4eee3'; e.lineWidth = 5; e.beginPath(); e.arc(64, 64, 50, 0, Math.PI * 2); e.stroke();
        e.fillStyle = '#f4eee3'; e.font = 'bold 44px Microsoft JhengHei, sans-serif'; e.textAlign = 'center'; e.textBaseline = 'middle'; e.fillText('一中', 64, 66);
        const et = new THREE.CanvasTexture(ec); et.colorSpace = THREE.SRGBColorSpace;
        for (const s of [-1, 1]) {
            const em = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: et, transparent: true }));
            em.position.set(s * 0.31, 1.35, 0); em.rotation.y = s * Math.PI / 2; g.add(em);
        }
        this.scene.add(g);
        const fp = [[-0.4, -3.1], [0.4, -3.1], [0.4, 3.1], [-0.4, 3.1]].map(([dx, dz]) => ({ x: 49.5 + dx, z: 4 + dz }));
        this.buildings.push({ mesh: g, name: '翻牆紀念磚牆', interactive: true, footprint: fp, mapColor: 0x9a4b38 });
    }

    // 中庭小山坡上的蘋果樹（官方資料只說「中庭的小山坡」，確切位置為估計）
    createCourtyardMound() {
        const g = new THREE.Group();
        g.position.set(-10, 0, -40);
        const mound = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x7cae62, roughness: 1 }));
        mound.scale.y = 0.17; mound.receiveShadow = true; g.add(mound);
        const tree = this.makeTree('apple', 1, this.seededRandom('apple'));
        tree.position.y = 1.15; g.add(tree);
        this.scene.add(g);
        this.buildings.push({ mesh: g, name: '蘋果樹', interactive: true });
    }

    getTreeKit() {
        if (this._treeKit) return this._treeKit;
        const M = (color, rough = 0.9) => new THREE.MeshStandardMaterial({ color, roughness: rough });
        const trunk = new THREE.CylinderGeometry(0.72, 1, 1, 8); trunk.translate(0, 0.5, 0);
        const frondGeo = new THREE.BoxGeometry(0.9, 0.05, 4.2); frondGeo.translate(0, 0, 2.1);
        this._treeKit = {
            trunk, frondGeo, sphere: new THREE.SphereGeometry(1, 9, 7),
            bark: M(0x6d5a47), barkLight: M(0x9a9183), palmTrunk: M(0xbab5a6, 0.8), crownshaft: M(0x86b04e),
            frond: new THREE.MeshStandardMaterial({ color: 0x3f8f3a, roughness: 0.7, side: THREE.DoubleSide }),
            leafA: M(0x2e6b35, 0.85), leafB: M(0x3f7d3b, 0.85), leafC: M(0x4f8f3e, 0.85), leafLight: M(0x86b85a, 0.85),
            apple: M(0xd7262e, 0.5), appleLeaf: M(0x4f9a43, 0.85)
        };
        return this._treeKit;
    }

    // kind: banyan（榕／雀榕類，寬冠）、bischofia（茄苳類，高大圓冠）、chinaberry（苦楝類，疏冠）、palm（大王椰子）、apple
    makeTree(kind, scale = 1, rand = Math.random) {
        const k = this.getTreeKit();
        const g = new THREE.Group();
        const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) => {
            const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; g.add(m); return m;
        };
        if (kind === 'palm') {
            const h = 8 + rand() * 3;
            add(k.trunk, k.palmTrunk, 0, 0, 0, 0.42, h, 0.42);
            add(k.trunk, k.crownshaft, 0, h, 0, 0.36, 1.6, 0.36);
            for (let i = 0; i < 9; i++) {
                const pivot = new THREE.Group();
                pivot.position.y = h + 1.5; pivot.rotation.y = i / 9 * Math.PI * 2 + rand() * 0.3;
                const fr = new THREE.Mesh(k.frondGeo, k.frond); fr.rotation.x = 0.35 + rand() * 0.5; fr.castShadow = true;
                pivot.add(fr); g.add(pivot);
            }
        } else if (kind === 'banyan') {
            add(k.trunk, k.barkLight, 0, 0, 0, 0.9, 3.6, 0.9);
            add(k.sphere, k.leafA, 0, 5.2, 0, 4.6, 2.6, 4.6);
            add(k.sphere, k.leafB, 2.6, 4.6, 1.2, 3.2, 2.0, 3.2);
            add(k.sphere, k.leafB, -2.4, 4.8, -1.4, 3.4, 2.1, 3.4);
            add(k.sphere, k.leafA, 0.4, 6.4, -0.5, 2.8, 1.7, 2.8);
        } else if (kind === 'bischofia') {
            add(k.trunk, k.bark, 0, 0, 0, 0.55, 5.2, 0.55);
            add(k.sphere, k.leafC, 0, 7.2, 0, 3.6, 3.2, 3.6);
            add(k.sphere, k.leafB, 1.8, 6.3, 0.8, 2.4, 2.0, 2.4);
            add(k.sphere, k.leafC, -1.7, 6.5, -0.9, 2.5, 2.1, 2.5);
        } else if (kind === 'chinaberry') {
            add(k.trunk, k.bark, 0, 0, 0, 0.34, 5.6, 0.34);
            for (const [x, y, z] of [[0, 7.4, 0], [1.6, 6.6, 0.6], [-1.5, 6.8, -0.5], [0.4, 6.2, -1.6], [-0.6, 6.4, 1.5]]) add(k.sphere, k.leafLight, x, y, z, 1.7, 1.3, 1.7);
        } else if (kind === 'apple') {
            add(k.trunk, k.bark, 0, 0, 0, 0.17, 1.7, 0.17);
            add(k.sphere, k.appleLeaf, 0, 2.5, 0, 1.6, 1.3, 1.6);
            for (let i = 0; i < 9; i++) {
                const a = rand() * Math.PI * 2, y = 2.0 + rand() * 1.0;
                add(k.sphere, k.apple, Math.cos(a) * 1.5, y, Math.sin(a) * 1.5, 0.13, 0.13, 0.13);
            }
        }
        g.scale.setScalar(scale);
        return g;
    }

    // 校園外圍行道樹。官方只提供「入德之門後方有植樹」與「中庭蘋果樹」，其餘樹種／位置是通用的綠化，之後可逐棵改
    createCampusTrees() {
        const rand = this.seededRandom('tcfsh-trees');
        const bd = this.campusBoundary;
        const bcx = bd.reduce((s, p) => s + p.x, 0) / bd.length, bcz = bd.reduce((s, p) => s + p.z, 0) / bd.length;
        const blocked = this.buildings.filter(b => b.footprint).map(b => ({ poly: b.footprint, margin: 3.5 }));
        for (const s of this.planSurfaces) if (s.color === '#c8694a' || s.color === '#416e83') blocked.push({ poly: s.points, margin: 2 });
        const spots = this.buildings.filter(b => b.mesh && !b.footprint).map(b => b.mesh.position).filter(Boolean);
        const kinds = ['banyan', 'bischofia', 'bischofia', 'chinaberry', 'chinaberry', 'palm', 'palm'];
        const ok = (x, z) => {
            for (const b of blocked) {
                if (this.isPointInPolygon(x, z, b.poly)) return false;
                const c = this.closestPointOnPolygon(x, z, b.poly);
                if (Math.hypot(x - c.x, z - c.z) < b.margin) return false;
            }
            for (const p of spots) if (Math.hypot(x - p.x, z - p.z) < 9) return false;
            for (const path of this.planPaths) {
                for (let i = 0; i < path.points.length - 1; i++) {
                    const a = path.points[i], b = path.points[i + 1];
                    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
                    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
                    if (Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)) < path.width / 2 + 2.2) return false;
                }
            }
            return true;
        };
        const place = (kind, x, z) => {
            const t = this.makeTree(kind, 0.85 + rand() * 0.4, rand);
            t.position.set(x, 0, z); t.rotation.y = rand() * Math.PI * 2; this.scene.add(t);
            this.coverZones.push({ x, z, radius: kind === 'palm' ? 2.8 : 3.8 });
        };
        for (let i = 0; i < bd.length; i++) {
            const a = bd[i], b = bd[(i + 1) % bd.length];
            const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
            let nx = -dz / len, nz = dx / len;
            if (nx * (bcx - a.x) + nz * (bcz - a.z) < 0) { nx = -nx; nz = -nz; }
            for (let d = 4 + rand() * 4; d < len - 3; d += 9 + rand() * 5) {
                const off = 2.6 + rand() * 1.4;
                const x = a.x + dx / len * d + nx * off, z = a.z + dz / len * d + nz * off;
                if (ok(x, z)) place(kinds[Math.floor(rand() * kinds.length)], x, z);
            }
        }
    }

    // ===== 建築風格表（GTA 式：飽和、鮮明、一棟一個性） =====
    getBuildingStyle(name) {
        // 依校方照片：慎思樓＝深紅磚＋白飾帶＋圓拱窗＋東端灰色高牆；景賢樓＝灰色混凝土＋紅磚直柱＋白欄杆陽台；莊敬樓＝1969 年的白色鋼筋混凝土樓；校史館＝磚造講堂
        const S = {
            '景賢樓':     { wall: 0xb9b6ae, band: 0xe6e3da, glass: 0x2f4650, frame: 0xdddbd3, roof: 0x7a7d7b, balcony: true, bandThick: 0.55 },
            // 麗澤樓（照片）：一樓粉灰花崗岩＋拱窗；上面是橘色牆、橘色柱夾著淺灰欄板的凹陽台；其中一層是拱形開口
            '麗澤樓':     { tiles: ['granite', 'lize', 'lize', 'lize', 'lizeArch', 'lize', 'lize'], wall: 0xd97b45, band: 0xc9c6bf, glass: 0x5b7480, frame: 0xe9e0cf, roof: 0x8d8b84, bandThick: 0.25 },
            // 莊敬樓（照片）：米白色水泥樓，一樓之上是開放式走廊（天花板有肋樑、白色欄板）。不放紅布條。
            '莊敬樓':     { tiles: ['zjGround', 'corridor', 'corridor', 'corridor'], wall: 0xece7df, band: 0xdcd6ca, recess: 0x4e463d, glass: 0x4f7f95, frame: 0xeceae2, roof: 0x8d8b84, bandThick: 0.3 },
            '慎思樓':     { wall: 0xa94a3a, band: 0xece6d8, glass: 0x2f4650, frame: 0xf2ede2, roof: 0x7a7d7b, brick: true, arch: true, bandThick: 0.4 },
            '敬業樓':     { wall: 0xd8d2c2, band: 0xece6d6, glass: 0x45707f, frame: 0xf2ede0, roof: 0x8d8b84, bandThick: 0.3 },
            '科學館':     { wall: 0xdedbd0, band: 0xefece4, glass: 0x3f6678, frame: 0xf4f2ec, roof: 0x5a5754, ribbon: true, bandThick: 0.3 },
            '康樂館':     { wall: 0xc9c4b8, band: 0xe3dfd4, glass: 0x4f7a8c, frame: 0xeeeae0, roof: 0x8d8b84, bandThick: 0.3 },
            '校史館':     { wall: 0xb5694a, band: 0xe8dcc4, glass: 0x4a3a2c, frame: 0xe8dcc4, roof: 0x4a4644, brick: true, arch: true, bandThick: 0.25 },
            '第一學生宿舍': { wall: 0xa8503f, band: 0xe2d6c3, glass: 0x5c8aa3, frame: 0xeadfcf, roof: 0x8d8b84, balcony: true, ac: true, bandThick: 0.25 },
            '第二學生宿舍': { wall: 0xa7a9a8, band: 0xd8d9d6, glass: 0x5c8aa3, frame: 0xe8e9e6, roof: 0x8d8b84, balcony: true, ac: true, bandThick: 0.25 },
            // 體育運動館（照片）：鮭魚紅磚牆＋米色格柱，一排排凹陽台，頂層是拱形開口
            '體育運動館': { tiles: ['pe', 'pe', 'pe', 'pe', 'peArch'], wall: 0xd9957a, band: 0xe6d8c6, glass: 0x3a5f70, frame: 0xeef0f0, roof: 0x8b949c, bandThick: 0.3 },
            '音樂館':     { wall: 0xd9d0bd, band: 0xf0e8d6, glass: 0x45707f, frame: 0xf4eee0, roof: 0x8d8b84, bandThick: 0.35 }
        };
        return S[name] || { wall: 0xcfc8b8, band: 0xeeeae0, glass: 0x4a6f80, frame: 0xf4f0e6, roof: 0x8d8b84, bandThick: 0.25 };
    }

    mixColor(a, b, t) {
        const c = new THREE.Color(a).lerp(new THREE.Color(b), t);
        return '#' + c.getHexString();
    }

    // 立面貼圖：一張 = 2 個開間 × 1 層樓，貼在牆上重複（窗、飾帶、冷氣、陽台都畫在這）

    // 依照片畫的「單層」立面貼圖（256×128 = 寬 8 公尺 × 一層樓；左右可無縫重複）
    makeTileTexture(kind, s) {
        const css = n => '#' + n.toString(16).padStart(6, '0');
        const c = document.createElement('canvas');
        c.width = 256; c.height = 128;
        const g = c.getContext('2d');
        const speckle = (n, a) => {
            for (let i = 0; i < n; i++) {
                g.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
                g.fillRect(Math.random() * 256, Math.random() * 128, 1 + Math.random() * 3, 4 + Math.random() * 20);
            }
        };
        const arch = (x, y, w, h) => {
            g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + w / 2);
            g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); g.lineTo(x + w, y + h); g.closePath();
        };
        const slab = (color) => {
            g.fillStyle = color; g.fillRect(0, 118, 256, 10);
            g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(0, 118, 256, 2);
        };
        g.fillStyle = css(s.wall); g.fillRect(0, 0, 256, 128);

        if (kind === 'corridor') {
            // 莊敬樓：開放走廊。上方天花板＋肋樑，中間是暗色後牆與窗，下方是整片白色欄板
            g.fillStyle = '#d8d3c8'; g.fillRect(0, 0, 256, 16);
            for (let x = 0; x <= 256; x += 64) {
                g.fillStyle = '#bdb7aa'; g.fillRect(x - 3, 0, 6, 16);
                g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x + 3, 0, 2, 16);
            }
            g.fillStyle = css(s.recess); g.fillRect(0, 16, 256, 46);
            g.fillStyle = '#2c3338';
            for (let x = 6; x < 256; x += 32) g.fillRect(x, 24, 24, 30);
            g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 62, 256, 3);
            g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(0, 108, 256, 10);
            slab(css(s.band));
            speckle(120, 0.035);
        } else if (kind === 'zjGround') {
            // 莊敬樓一樓：淺灰牆＋裝鐵窗的暗色窗
            for (let bay = 0; bay < 2; bay++) {
                const x = bay * 128 + 20;
                g.fillStyle = '#262c30'; g.fillRect(x, 34, 88, 64);
                g.strokeStyle = '#6d747a'; g.lineWidth = 2;
                for (let i = 1; i < 11; i++) { g.beginPath(); g.moveTo(x + i * 8, 34); g.lineTo(x + i * 8, 98); g.stroke(); }
                g.fillStyle = css(s.band); g.fillRect(x - 4, 98, 96, 6);
            }
            g.fillStyle = '#cfc9bd'; g.fillRect(0, 108, 256, 10);
            slab(css(s.band));
            speckle(100, 0.04);
        } else if (kind === 'lize') {
            // 麗澤樓：橘柱＋凹陽台（暗色後牆、紅色欄杆）＋淺灰欄板
            for (let bay = 0; bay < 2; bay++) {
                const bx = bay * 128, ox = bx + 22, w = 106;
                g.fillStyle = '#4c4842'; g.fillRect(ox, 10, w, 82);
                g.fillStyle = '#d3cdc0'; g.fillRect(ox, 10, w, 10);
                for (let k = 0; k < 3; k++) {
                    g.fillStyle = css(s.frame); g.fillRect(ox + 6 + k * 34, 42, 30, 30);
                    g.fillStyle = css(s.glass); g.fillRect(ox + 8 + k * 34, 44, 26, 26);
                }
                g.fillStyle = '#a8473b'; g.fillRect(ox, 76, w, 4);
                g.fillStyle = css(s.band); g.fillRect(ox - 2, 92, w + 4, 26);
                g.fillStyle = '#9a4a48'; g.fillRect(ox - 2, 92, w + 4, 3);   // 欄板上緣的酒紅飾條
                g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(ox - 2, 108, w + 4, 10);
            }
            slab('#c8683a');
            speckle(120, 0.03);
        } else if (kind === 'lizeArch') {
            // 麗澤樓：拱形開口那一層
            for (let bay = 0; bay < 2; bay++) {
                const x = bay * 128 + 14, w = 100;
                g.fillStyle = '#4c4842'; arch(x, 10, w, 92); g.fill();
                g.strokeStyle = css(s.frame); g.lineWidth = 4; arch(x, 10, w, 92); g.stroke();
                g.fillStyle = css(s.glass);
                for (let k = 0; k < 3; k++) g.fillRect(x + 8 + k * 30, 62, 26, 26);
                g.fillStyle = css(s.band); g.fillRect(x - 2, 96, w + 4, 16);
                g.fillStyle = '#9a4a48'; g.fillRect(x - 2, 96, w + 4, 2);
            }
            slab('#c8683a');
            speckle(120, 0.03);
        } else if (kind === 'granite') {
            // 麗澤樓一樓：粉灰花崗岩＋一排拱窗
            g.fillStyle = '#a79a94'; g.fillRect(0, 0, 256, 128);
            g.strokeStyle = 'rgba(60,45,45,0.18)'; g.lineWidth = 1;
            for (let y = 0; y < 128; y += 14) {
                g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(256, y + 0.5); g.stroke();
                for (let x = ((y / 14) % 2) * 14; x < 256; x += 28) { g.beginPath(); g.moveTo(x + 0.5, y); g.lineTo(x + 0.5, y + 14); g.stroke(); }
            }
            for (let i = 0; i < 3; i++) {
                const x = 18 + i * 82;
                g.fillStyle = '#2f3a40'; arch(x, 28, 48, 82); g.fill();
                g.strokeStyle = '#cfc3bb'; g.lineWidth = 4; arch(x, 28, 48, 82); g.stroke();
            }
            g.fillStyle = '#b8aca6'; g.fillRect(0, 0, 256, 10);
            g.fillStyle = '#8d817b'; g.fillRect(0, 114, 256, 14);
            speckle(120, 0.04);
        } else if (kind === 'lizeEnd') {
            // 麗澤樓山牆：橘色牆＋小窗
            for (const x of [44, 172]) {
                g.fillStyle = css(s.frame); g.fillRect(x - 3, 30, 46, 54);
                g.fillStyle = css(s.glass); g.fillRect(x, 33, 40, 48);
                g.fillStyle = css(s.frame); g.fillRect(x + 19, 33, 2, 48);
            }
            slab('#c8683a');
            speckle(140, 0.03);
        } else if (kind === 'lizeBackG') {
            // 麗澤樓背面一樓：灰色混凝土＋暗色窗帶
            g.fillStyle = '#b9b5ab'; g.fillRect(0, 0, 256, 128);
            g.fillStyle = '#2c3338'; g.fillRect(6, 34, 244, 58);
            g.fillStyle = '#8a8f92';
            for (let x = 6; x <= 250; x += 30) g.fillRect(x, 34, 3, 58);
            g.fillRect(6, 60, 244, 2);
            slab('#9d998f');
            speckle(140, 0.04);
        } else if (kind === 'lizeBack') {
            // 麗澤樓背面（照片）：灰牆窗帶（含冷氣）＋整排粉紅色圓角欄板
            g.fillStyle = '#d4d2cb'; g.fillRect(0, 0, 256, 128);
            g.fillStyle = '#5f6e74'; g.fillRect(0, 18, 256, 44);
            g.fillStyle = '#e9e7e0';
            for (let x = 0; x <= 256; x += 32) g.fillRect(x, 18, 3, 44);
            g.fillRect(0, 38, 256, 2);
            g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, 18, 256, 8);
            g.fillStyle = '#c9cdd0'; g.fillRect(150, 64, 26, 14);
            g.fillStyle = '#6b7075'; for (let i = 0; i < 4; i++) g.fillRect(154 + i * 6, 67, 3, 8);
            const grad = g.createLinearGradient(0, 78, 0, 118);
            grad.addColorStop(0, '#d8665f'); grad.addColorStop(1, '#bd4a46');
            g.fillStyle = grad; g.fillRect(0, 78, 256, 40);
            g.fillStyle = '#e58a82'; g.fillRect(0, 78, 256, 3);
            g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 112, 256, 6);
            slab('#a8403c');
            speckle(120, 0.03);
        } else if (kind === 'pe' || kind === 'peArch') {
            // 體育運動館：鮭魚紅磚＋米色格柱＋白牆凹陽台，頂層為拱形
            g.strokeStyle = 'rgba(90,40,25,0.14)'; g.lineWidth = 1;
            for (let y = 0; y < 128; y += 5) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(256, y + 0.5); g.stroke(); }
            for (let bay = 0; bay < 2; bay++) {
                const bx = bay * 128;
                g.fillStyle = css(s.band); g.fillRect(bx - 3, 0, 6, 118);
                const x = bx + 12, w = 104;
                const grad = g.createLinearGradient(0, 8, 0, 56);
                grad.addColorStop(0, '#8f877c'); grad.addColorStop(1, '#ece6da');
                g.fillStyle = grad;
                if (kind === 'peArch') { arch(x, 6, w, 90); g.fill(); } else { g.fillRect(x, 10, w, 82); }
                g.fillStyle = '#3d4348';
                for (let k = 0; k < 3; k++) g.fillRect(x + 8 + k * 32, 58, 22, 24);
                g.fillStyle = '#f4f1ea'; g.fillRect(x, 80, w, 3);
                g.fillStyle = css(s.wall); g.fillRect(x - 6, 92, w + 12, 26);
                g.fillStyle = css(s.band); g.fillRect(x - 6, 90, w + 12, 4);
            }
            slab(css(s.band));
            speckle(100, 0.03);
        }
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        return tex;
    }

    // 透明底的「分散字」招牌（chars 由左到右排列；傳統直書橫寫是由右到左，呼叫時自行反轉）
    charPlane(chars, w, h, color) {
        const c = document.createElement('canvas');
        c.width = Math.min(2048, Math.round(w * 64)); c.height = Math.max(32, Math.round(h * 64));
        const x = c.getContext('2d');
        x.fillStyle = color;
        x.font = `bold ${Math.round(c.height * 0.85)}px 'Microsoft JhengHei', 'PMingLiU', serif`;
        x.textAlign = 'center'; x.textBaseline = 'middle';
        chars.forEach((ch, i) => x.fillText(ch, c.width * (i + 0.5) / chars.length, c.height / 2));
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
        return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    }

    // 找「朝向某個目標點」的最長外牆（用來找中庭側的正面、南北端牆）
    getFacingEdge(footprint, tx, tz, minDot = 0.5) {
        const cx = footprint.reduce((a, p) => a + p.x, 0) / footprint.length;
        const cz = footprint.reduce((a, p) => a + p.z, 0) / footprint.length;
        let dx = tx - cx, dz = tz - cz; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        let best = null;
        for (let i = 0; i < footprint.length; i++) {
            const start = footprint[i], end = footprint[(i + 1) % footprint.length];
            const ex = end.x - start.x, ez = end.z - start.z, len = Math.hypot(ex, ez);
            if (len < 4) continue;
            let nx = -ez / len, nz = ex / len;
            const mx = (start.x + end.x) / 2, mz = (start.z + end.z) / 2;
            if (nx * (cx - mx) + nz * (cz - mz) > 0) { nx = -nx; nz = -nz; }
            const dot = nx * dx + nz * dz;
            if (dot < minDot) continue;
            const score = len * dot;
            if (!best || score > best.score) best = { start, end, nx, nz, score, len };
        }
        return best || this.getFrontEdge(footprint);
    }

    // 在某面外牆上建一個「區域座標」群組：+z = 朝外、+x = 沿牆；t = 沿牆位置 0~1
    edgeFrame(edge, t = 0.5) {
        const g = new THREE.Group();
        g.position.set(edge.start.x + (edge.end.x - edge.start.x) * t, 0, edge.start.z + (edge.end.z - edge.start.z) * t);
        g.rotation.y = Math.atan2(edge.nx, edge.nz);
        const add = (geo, mat, x, y, z, cast = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; g.add(m); return m; };
        return { g, add };
    }

    makeFacadeTexture(s) {
        this._facadeCache = this._facadeCache || {};
        const key = JSON.stringify(s);
        if (this._facadeCache[key]) return this._facadeCache[key];
        const css = n => '#' + n.toString(16).padStart(6, '0');
        if (s.tile) { const t = this.makeTileTexture(s.tile, s); this._facadeCache[key] = t; return t; }
        const c = document.createElement('canvas');
        c.width = 256; c.height = 128;
        const g = c.getContext('2d');
        g.fillStyle = css(s.wall); g.fillRect(0, 0, 256, 128);
        // 牆面髒污／質感
        for (let i = 0; i < 160; i++) {
            g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.04)';
            g.fillRect(Math.random() * 256, Math.random() * 128, 1 + Math.random() * 3, 6 + Math.random() * 30);
        }
        if (s.grime) {   // 1969 年的白色水泥樓，積滿塵炱污漬
            for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(55,48,40,${0.05 + Math.random() * 0.09})`; g.fillRect(Math.random() * 256, 20 + Math.random() * 90, 2 + Math.random() * 4, 14 + Math.random() * 50); }
        }
        if (s.brick) {
            g.strokeStyle = 'rgba(60,20,15,0.28)'; g.lineWidth = 1;
            for (let y = 0; y < 128; y += 6) {
                g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(256, y + 0.5); g.stroke();
                for (let x = ((y / 6) % 2) * 8; x < 256; x += 16) { g.beginPath(); g.moveTo(x + 0.5, y); g.lineTo(x + 0.5, y + 6); g.stroke(); }
            }
        }
        const winPath = (x, y, w, h, arch) => {
            g.beginPath();
            if (arch) { g.moveTo(x, y + h); g.lineTo(x, y + w / 2); g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); g.lineTo(x + w, y + h); }
            else g.rect(x, y, w, h);
            g.closePath();
        };
        const glassFill = (x, y, w, h, arch) => {
            const grad = g.createLinearGradient(0, y, 0, y + h);
            grad.addColorStop(0, this.mixColor(s.glass, 0xffffff, 0.35));
            grad.addColorStop(1, css(s.glass));
            g.fillStyle = grad; winPath(x, y, w, h, arch); g.fill();
        };
        if (s.ribbon) {
            // 帶狀連續窗
            g.fillStyle = css(s.frame); g.fillRect(0, 30, 256, 62);
            glassFill(0, 34, 256, 54, false);
            g.fillStyle = css(s.frame);
            for (let x = 0; x < 256; x += 32) g.fillRect(x, 34, 3, 54);
            g.fillRect(0, 58, 256, 2);
            g.fillStyle = 'rgba(255,255,255,0.14)';
            g.beginPath(); g.moveTo(20, 88); g.lineTo(70, 34); g.lineTo(92, 34); g.lineTo(42, 88); g.fill();
        } else {
            for (let bay = 0; bay < 2; bay++) {
                const bx = bay * 128, x = bx + 30, y = 26, w = 68, h = 70;
                g.fillStyle = css(s.frame); winPath(x - 5, y - 5, w + 10, h + 10, s.arch); g.fill();
                glassFill(x, y, w, h, s.arch);
                g.fillStyle = css(s.frame);
                g.fillRect(x + w / 2 - 1.5, y, 3, h);
                g.fillRect(x, y + h * 0.42, w, 3);
                g.fillStyle = 'rgba(255,255,255,0.16)';
                g.beginPath(); g.moveTo(x + 6, y + h); g.lineTo(x + 30, y + 8); g.lineTo(x + 44, y + 8); g.lineTo(x + 20, y + h); g.fill();
                g.fillStyle = css(s.band); g.fillRect(x - 8, y + h + 4, w + 16, 5);
                if (s.arch) { g.fillStyle = css(s.band); g.fillRect(x + w / 2 - 6, y - 12, 12, 7); } // 拱心石
                if (s.ac && bay === 1) {
                    g.fillStyle = '#c9ccd0'; g.fillRect(x + 6, y + h + 12, 46, 16);
                    g.fillStyle = '#6b7075'; for (let i = 0; i < 4; i++) g.fillRect(x + 10 + i * 10, y + h + 15, 6, 10);
                }
            }
            if (s.balcony) {
                g.fillStyle = css(s.band); g.fillRect(0, 100, 256, 6);
                g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2;
                for (let x = 4; x < 256; x += 12) { g.beginPath(); g.moveTo(x, 100); g.lineTo(x, 86); g.stroke(); }
                g.fillStyle = css(s.band); g.fillRect(0, 84, 256, 3);
            }
        }
        // 樓板線
        g.fillStyle = css(s.band); g.fillRect(0, 120, 256, 8);
        g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 118, 256, 2);
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        this._facadeCache[key] = tex;
        return tex;
    }

    seededRandom(seedText) {
        let h = 2166136261;
        for (const ch of seedText) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
        return () => { h += 0x6D2B79F5; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }

    // ===================================================================
    // 校史館（原「第一中學校講堂」，1937）
    // 依三張照片重建：米黃洗石子牆、深藍灰金屬二落水屋頂。
    //  ‧ 正面（山牆端）：深門廊＋三道門＋四根方柱、三扇高窗、金色「校史館」、兩側矮翼牆、山牆上三個小方窗
    //  ‧ 左右長邊：七個開間，上層是細長高窗＋窗上橫飾板，下層是雨庇下的一排窗，各有一個入口；牆上有深色「校史館」
    //  ‧ 三面共 5 道門（正面 3 道、左右各 1 道）都可以走進去，內部只有空殼（地板、牆、天花板），沒有設計內部
    // ===================================================================
    hallStuccoTexture() {
        const c = document.createElement('canvas'); c.width = c.height = 256;
        const g = c.getContext('2d');
        g.fillStyle = '#e4cf98'; g.fillRect(0, 0, 256, 256);
        const rand = this.seededRandom('hall-stucco');
        for (let i = 0; i < 900; i++) {
            g.fillStyle = rand() < 0.5 ? `rgba(120,95,50,${0.03 + rand() * 0.05})` : `rgba(255,248,225,${0.03 + rand() * 0.06})`;
            g.fillRect(rand() * 256, rand() * 256, 1 + rand() * 4, 1 + rand() * 4);
        }
        for (let i = 0; i < 16; i++) {   // 淡淡的雨痕
            g.fillStyle = `rgba(90,70,40,${0.02 + rand() * 0.035})`;
            g.fillRect(rand() * 256, 0, 2 + rand() * 5, 120 + rand() * 136);
        }
        const t = new THREE.CanvasTexture(c);
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
        return t;
    }

    // 格子窗貼圖（木框＋深色玻璃），cols × rows 格
    hallWindowTexture(cols, rows, frame = '#8f4a22') {
        this._hallWinCache = this._hallWinCache || {};
        const key = `${cols}x${rows}${frame}`;
        if (this._hallWinCache[key]) return this._hallWinCache[key];
        const m = 7, bar = 4, pw = 30, ph = 30;
        const W = m * 2 + cols * pw + (cols - 1) * bar, H = m * 2 + rows * ph + (rows - 1) * bar;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d');
        g.fillStyle = frame; g.fillRect(0, 0, W, H);
        for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
            const x = m + i * (pw + bar), y = m + j * (ph + bar);
            const grad = g.createLinearGradient(0, y, 0, y + ph);
            grad.addColorStop(0, '#6f8794'); grad.addColorStop(1, '#2a363f');
            g.fillStyle = grad; g.fillRect(x, y, pw, ph);
            g.fillStyle = 'rgba(255,255,255,0.14)';
            g.beginPath(); g.moveTo(x, y + ph); g.lineTo(x + pw * 0.55, y); g.lineTo(x + pw * 0.8, y); g.lineTo(x + pw * 0.25, y + ph); g.fill();
        }
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
        this._hallWinCache[key] = t;
        return t;
    }

    // 木門扇貼圖：上半玻璃格、下半木板
    hallDoorTexture() {
        if (this._hallDoorTex) return this._hallDoorTex;
        const c = document.createElement('canvas'); c.width = 64; c.height = 160;
        const g = c.getContext('2d');
        g.fillStyle = '#a4531f'; g.fillRect(0, 0, 64, 160);
        g.fillStyle = '#c0692c'; g.fillRect(0, 0, 64, 4); g.fillRect(0, 0, 4, 160); g.fillRect(60, 0, 4, 160);
        for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) {
            const x = 8 + i * 25, y = 10 + j * 25;
            const grad = g.createLinearGradient(0, y, 0, y + 21);
            grad.addColorStop(0, '#7b95a2'); grad.addColorStop(1, '#2d3a43');
            g.fillStyle = grad; g.fillRect(x, y, 23, 21);
        }
        g.fillStyle = '#8a4218'; g.fillRect(8, 118, 48, 36);
        g.strokeStyle = '#6d3213'; g.lineWidth = 2; g.strokeRect(12, 122, 40, 28);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
        this._hallDoorTex = t;
        return t;
    }

    // 金屬屋頂貼圖（直立縫）
    hallRoofTexture() {
        const c = document.createElement('canvas'); c.width = 64; c.height = 64;
        const g = c.getContext('2d');
        g.fillStyle = '#4b5662'; g.fillRect(0, 0, 64, 64);
        g.fillStyle = '#5d6975'; g.fillRect(0, 0, 4, 64);
        g.fillStyle = '#39424c'; g.fillRect(4, 0, 2, 64);
        const t = new THREE.CanvasTexture(c);
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
        return t;
    }

    // 立在牆上的字（dark/gold），chars 由左到右排列
    makeCharSign(chars, w, h, color, ppm = 160) {
        const c = document.createElement('canvas');
        c.width = Math.round(w * ppm); c.height = Math.round(h * ppm);
        const g = c.getContext('2d');
        g.fillStyle = color;
        g.font = `bold ${Math.round(c.height * 0.82)}px 'Microsoft JhengHei', 'PingFang TC', 'PMingLiU', 'Noto Serif TC', serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        chars.forEach((ch, i) => g.fillText(ch, c.width * (i + 0.5) / chars.length, c.height * 0.52));
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
        return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    }

    createHistoryHall(footprint, H) {
        const dist = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
        const n = footprint.length;
        const edges = footprint.map((a, i) => ({ a, b: footprint[(i + 1) % n], l: dist(a, footprint[(i + 1) % n]) }));
        const byLen = edges.slice().sort((p, q) => p.l - q.l);
        const shorts = byLen.slice(0, 2), longs = byLen.slice(2);
        const cx = footprint.reduce((s, p) => s + p.x, 0) / n, cz = footprint.reduce((s, p) => s + p.z, 0) / n;
        const mid = e => ({ x: (e.a.x + e.b.x) / 2, z: (e.a.z + e.b.z) / 2 });
        // 正面 = 兩條短邊（山牆端）中離校園主步道比較近的那一條
        const ref = this.projectMapPoint(120.6859890, 24.1502640);
        const front = shorts.slice().sort((p, q) => dist(mid(p), ref) - dist(mid(q), ref))[0];
        let nx = -(front.b.z - front.a.z), nz = front.b.x - front.a.x;
        const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl;
        const fm = mid(front);
        if (nx * (fm.x - cx) + nz * (fm.z - cz) < 0) { nx = -nx; nz = -nz; }
        const theta = Math.atan2(nx, nz);          // 區域 +z = 正面朝外；區域 +x = 站在正面外面看的右手邊
        const W = (shorts[0].l + shorts[1].l) / 2, L = (longs[0].l + longs[1].l) / 2;

        const t = 0.36;            // 牆厚
        const R = 4.2;             // 屋脊高於簷口
        const DOOR_H = 3.3;
        const CANOPY_Y = 3.9;      // 長邊雨庇高度
        const b = L / 7;           // 長邊開間寬
        const hall = new THREE.Group();
        hall.position.set(cx, 0, cz);
        hall.rotation.y = theta;
        const colliders = [], floorZones = [];

        // ---- 材質 ----
        const stuccoTex = this.hallStuccoTexture();
        const std = (color, rough = 0.9, extra = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: rough }, extra));
        const M = {
            stucco: std(0xffffff, 0.92, { map: stuccoTex, emissive: 0x2a2212 }),
            trim: std(0xcdbb92),
            trimDark: std(0xc2ac7c),
            plinth: std(0xa89a7e, 0.95),
            stone: std(0xb7b0a0, 0.95),
            wood: std(0x8f4a22, 0.75),
            floor: std(0xd8cfba, 0.9, { emissive: 0x3c352a }),
            ceiling: std(0xe8dfc8, 0.95, { side: THREE.DoubleSide, emissive: 0x4c4533 }),
            roof: std(0xffffff, 0.8, { map: this.hallRoofTexture(), side: THREE.DoubleSide }),
            ridge: std(0x343b43, 0.8),
            pipe: std(0x7b8084, 0.6, { metalness: 0.3 }),
            gold: std(0xd8a82e, 0.4, { metalness: 0.5 })
        };
        const doorMat = new THREE.MeshStandardMaterial({ map: this.hallDoorTexture(), roughness: 0.7 });
        const winMat = (cols, rows) => new THREE.MeshStandardMaterial({ map: this.hallWindowTexture(cols, rows), roughness: 0.35, metalness: 0.1 });

        const box = (parent, w, h, d, mat, x, y, z, cast = true) => {
            const geo = new THREE.BoxGeometry(w, h, d);
            if (mat === M.stucco) {      // 讓牆面貼圖依實際尺寸平鋪（每 4 公尺一張）
                const uv = geo.attributes.uv;
                const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
                for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
                    const i = f * 4 + k;
                    uv.setXY(i, uv.getX(i) * dims[f][0] / 4, uv.getY(i) * dims[f][1] / 4);
                }
            }
            const m = new THREE.Mesh(geo, mat);
            m.position.set(x, y, z);
            m.castShadow = cast; m.receiveShadow = true;
            parent.add(m);
            return m;
        };
        const plane = (parent, mat, w, h, x, y, z) => {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
            m.position.set(x, y, z);
            parent.add(m);
            return m;
        };
        const addLeaves = (parent, x, halfW, z) => {      // 兩扇打開的玻璃木門（向外開）
            const lw = halfW - 0.05;
            for (const s of [-1, 1]) {
                const pivot = new THREE.Group();
                pivot.position.set(x + s * halfW, 0.1, z);
                pivot.rotation.y = s * 1.45;
                const leaf = new THREE.Mesh(new THREE.BoxGeometry(lw, 3.1, 0.06), doorMat);
                leaf.position.set(-s * lw / 2, 1.55, 0);
                leaf.castShadow = true;
                pivot.add(leaf);
                parent.add(pivot);
            }
        };
        const spans = (lo, hi, ops) => {     // 牆扣掉門洞之後剩下的實牆區段
            const out = []; let cur = lo;
            for (const o of ops) { const a = o.c - o.w / 2; if (a > cur) out.push([cur, a]); cur = o.c + o.w / 2; }
            if (cur < hi) out.push([cur, hi]);
            return out;
        };

        // ---- 地板（內部只有空殼）----
        box(hall, W - 2 * t, 0.1, L - 2 * t, M.floor, 0, 0.05, 0, false);
        floorZones.push([-W / 2 + t, W / 2 - t, -L / 2 + t, L / 2 - t, 0.1]);

        // ---- 牆身（有門洞）----
        // 正面：三道門
        const frontDoors = [-2.75, 0, 2.75].map(c => ({ c, w: 2.1, h: DOOR_H }));
        for (const [a, bb] of spans(-W / 2 + t, W / 2 - t, frontDoors)) {
            box(hall, bb - a, H, t, M.stucco, (a + bb) / 2, H / 2, L / 2 - t / 2);
            box(hall, bb - a, 0.55, 0.08, M.plinth, (a + bb) / 2, 0.275, L / 2 + 0.04);
            colliders.push([a, bb, L / 2 - t, L / 2]);
        }
        for (const o of frontDoors) {
            box(hall, o.w, H - o.h, t, M.stucco, o.c, (o.h + H) / 2, L / 2 - t / 2);
            box(hall, o.w, 0.1, t, M.stone, o.c, 0.05, L / 2 - t / 2, false);   // 門檻
        }
        // 背面：整面實牆
        box(hall, W - 2 * t, H, t, M.stucco, 0, H / 2, -L / 2 + t / 2);
        box(hall, W - 2 * t, 0.55, 0.08, M.plinth, 0, 0.275, -L / 2 - 0.04);
        colliders.push([-W / 2 + t, W / 2 - t, -L / 2, -L / 2 + t]);
        // 山牆三角
        for (const zStart of [L / 2 - t, -L / 2]) {
            const sh = new THREE.Shape();
            sh.moveTo(-W / 2, 0); sh.lineTo(W / 2, 0); sh.lineTo(0, R - 0.14); sh.closePath();
            const gg = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false });
            const uv = gg.attributes.uv;
            for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 4, uv.getY(i) / 4);
            gg.translate(0, H, zStart);
            const gm = new THREE.Mesh(gg, M.stucco);
            gm.castShadow = true; gm.receiveShadow = true;
            hall.add(gm);
        }
        // 長邊：各一道門（由正面數過來第 3 個開間）
        const doorZ = L / 2 - 2.5 * b;
        const sideDoor = [{ c: doorZ, w: 2.2, h: DOOR_H }];
        for (const sx of [-1, 1]) {
            for (const [a, bb] of spans(-L / 2, L / 2, sideDoor)) {
                box(hall, t, H, bb - a, M.stucco, sx * (W / 2 - t / 2), H / 2, (a + bb) / 2);
                box(hall, 0.08, 0.55, bb - a, M.plinth, sx * (W / 2 + 0.04), 0.275, (a + bb) / 2);
                colliders.push(sx > 0 ? [W / 2 - t, W / 2, a, bb] : [-W / 2, -W / 2 + t, a, bb]);
            }
            const o = sideDoor[0];
            box(hall, t, H - o.h, o.w, M.stucco, sx * (W / 2 - t / 2), (o.h + H) / 2, o.c);
            box(hall, t, 0.1, o.w, M.stone, sx * (W / 2 - t / 2), 0.05, o.c, false);
            // 門前走道高度（讓人走上門檻不會陷進去）
            const x0 = sx > 0 ? W / 2 - t : -W / 2 - 1.0, x1 = sx > 0 ? W / 2 + 1.0 : -W / 2 + t;
            floorZones.push([x0, x1, doorZ - 1.6, doorZ + 1.6, 0.1]);
            const y0 = sx > 0 ? W / 2 + 1.0 : -W / 2 - 1.5, y1 = sx > 0 ? W / 2 + 1.5 : -W / 2 - 1.0;
            floorZones.push([y0, y1, doorZ - 1.9, doorZ + 1.9, 0.05]);
        }

        // ---- 屋頂（深藍灰金屬、直立縫）＋ 內側米色天花板 ----
        const oh = 0.7, ohz = 0.6, slope = R / (W / 2);
        const Xe = W / 2 + oh, Ze = L / 2 + ohz, Ye = H - oh * slope;
        const slopeLen = Math.hypot(Xe, R + oh * slope);
        const roofSide = (sx, drop, mat, cast) => {
            const v = [[sx * Xe, Ye - drop, -Ze], [sx * Xe, Ye - drop, Ze], [0, H + R - drop, Ze], [0, H + R - drop, -Ze]];
            const pos = v.flat();
            const uvs = [-Ze / 0.6, 0, Ze / 0.6, 0, Ze / 0.6, slopeLen / 3, -Ze / 0.6, slopeLen / 3];
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            g.setIndex([0, 1, 2, 0, 2, 3]);
            g.computeVertexNormals();
            const m = new THREE.Mesh(g, mat);
            m.castShadow = cast; m.receiveShadow = true;
            hall.add(m);
        };
        for (const sx of [-1, 1]) {
            roofSide(sx, 0, M.roof, true);
            roofSide(sx, 0.1, M.ceiling, false);
            box(hall, 0.1, 0.26, 2 * Ze, M.ridge, sx * Xe, Ye - 0.04, 0);     // 簷口封板
        }
        box(hall, 0.5, 0.22, 2 * Ze + 0.1, M.ridge, 0, H + R + 0.03, 0);      // 屋脊

        // ---- 長邊立面（左右各一）----
        const decorLong = (sx) => {
            const g = new THREE.Group();
            g.position.set(sx * W / 2, 0, 0);
            g.rotation.y = sx * Math.PI / 2;           // g 的 +z = 朝外，+x = 站在外面看的右手邊
            hall.add(g);
            const ux = z => -sx * z;                   // 區域 z → g 的 x
            const seam = i => L / 2 - i * b;
            const zc = i => L / 2 - (i + 0.5) * b;
            box(g, L, 0.2, 0.5, M.trim, 0, CANOPY_Y + 0.05, 0.25);                 // 一樓雨庇
            box(g, L + 0.1, 0.26, 0.34, M.trim, 0, H - 0.13, 0.17);                // 簷口飾帶
            for (let i = 1; i <= 6; i++) box(g, 0.5, H - 4.2, 0.14, M.trim, ux(seam(i)), (4.15 + H - 0.26) / 2, 0.07);   // 壁柱
            const tallWin = winMat(2, 8), lowWin = winMat(4, 3);
            for (let i = 0; i < 7; i++) {
                const x = ux(zc(i));
                // 上層：細長高窗、窗台、窗上橫飾板
                box(g, 1.0, 3.05, 0.05, M.trim, x, 6.05, 0.025);
                plane(g, tallWin, 0.85, 2.9, x, 6.05, 0.058);
                box(g, 1.25, 0.12, 0.26, M.stone, x, 4.5, 0.13);
                box(g, 2.4, 0.7, 0.05, M.trimDark, x, 7.85, 0.025);
                // 下層：雨庇下的窗（第 3 開間是入口、最後 2 個開間是實牆）
                if (i === 0 || i === 1 || i === 3 || i === 4) {
                    box(g, 2.7, 2.4, 0.06, M.wood, x, 2.1, 0.03);
                    plane(g, lowWin, 2.5, 2.2, x, 2.1, 0.065);
                    box(g, 3.0, 0.12, 0.28, M.stone, x, 0.88, 0.14);
                }
            }
            // 入口：木門框、兩扇打開的玻璃木門、台階
            const dx = ux(doorZ);
            for (const s of [-1, 1]) box(g, 0.16, DOOR_H + 0.15, t + 0.1, M.wood, dx + s * 1.18, (DOOR_H + 0.15) / 2, -t / 2 + 0.05);
            box(g, 2.52, 0.18, t + 0.1, M.wood, dx, DOOR_H + 0.09, -t / 2 + 0.05);
            addLeaves(g, dx, 1.1, 0.06);
            box(g, 3.2, 0.1, 1.0, M.stone, dx, 0.05, 0.5);
            box(g, 3.8, 0.05, 0.5, M.stone, dx, 0.025, 1.25);
            // 排水管
            for (const i of [1, 6]) {
                const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, H - 0.45, 8), M.pipe);
                pipe.position.set(ux(seam(i)), 0.15 + (H - 0.45) / 2, 0.21);
                g.add(pipe);
            }
            // 牆上的深色「校史館」（由右到左讀）
            const sign = this.makeCharSign(['館', '史', '校'], 3.6, 1.0, '#34201a');
            sign.position.set(ux(seam(3)), 5.9, 0.16);
            g.add(sign);
        };
        decorLong(-1);
        decorLong(1);

        // ---- 正面立面（山牆端）----
        const f = new THREE.Group();
        f.position.set(0, 0, L / 2);
        hall.add(f);
        const CB = 0.4;                       // 中央塊凸出牆面的深度
        box(f, 10.2, H - 4.15, CB, M.stucco, 0, (4.15 + H) / 2, CB / 2);
        box(f, 10.2, 0.25, 2.6, M.trim, 0, 4.025, 1.3);                           // 深門廊的雨庇
        box(f, 10.7, 0.3, 0.9, M.trim, 0, H, 0.4);                                // 中央塊簷口
        for (const px of [-4.125, -1.375, 1.375, 4.125]) {                        // 四根方柱
            box(f, 0.65, 3.9, 0.65, M.stucco, px, 1.95, 2.2);
            box(f, 0.78, 0.35, 0.78, M.plinth, px, 0.175, 2.2);
            box(f, 0.8, 0.14, 0.8, M.trim, px, 3.83, 2.2);
            colliders.push([px - 0.39, px + 0.39, L / 2 + 2.2 - 0.39, L / 2 + 2.2 + 0.39]);
        }
        box(f, 9.4, 0.1, 2.6, M.stone, 0, 0.05, 1.3, false);                      // 門廊地坪
        box(f, 10.0, 0.05, 0.6, M.stone, 0, 0.025, 2.9, false);                   // 前階
        floorZones.push([-4.7, 4.7, L / 2 - t, L / 2 + 2.6, 0.1]);
        floorZones.push([-5.0, 5.0, L / 2 + 2.6, L / 2 + 3.2, 0.05]);
        const wingW = W / 2 - 5.1;
        for (const sx of [-1, 1]) {                                               // 兩側矮翼牆
            const xc = sx * (5.1 + W / 2) / 2;
            box(f, wingW, 4.3, 0.9, M.stucco, xc, 2.15, 0.45);
            box(f, wingW + 0.08, 0.55, 0.98, M.plinth, xc, 0.275, 0.45);
            box(f, wingW + 0.1, 0.14, 1.02, M.stone, xc, 4.37, 0.45);
            box(f, 2.4, 2.1, 0.06, M.wood, xc, 2.25, 0.93);
            plane(f, winMat(3, 3), 2.2, 1.9, xc, 2.25, 0.965);
            box(f, 2.7, 0.12, 0.26, M.stone, xc, 1.14, 1.0);
            colliders.push(sx > 0 ? [5.1, W / 2, L / 2, L / 2 + 0.9] : [-W / 2, -5.1, L / 2, L / 2 + 0.9]);
            box(f, 0.9, 0.7, 1.2, M.stone, sx * 5.5, 0.35, 3.5);                  // 門前石墩
            colliders.push([sx * 5.5 - 0.45, sx * 5.5 + 0.45, L / 2 + 2.9, L / 2 + 4.1]);
        }
        for (const x of [-2.75, 0, 2.75]) {                                       // 三扇高窗＋窗上裝飾板
            box(f, 2.15, 3.15, 0.06, M.wood, x, 6.1, CB + 0.03);
            plane(f, winMat(3, 6), 2.0, 3.0, x, 6.1, CB + 0.065);
            box(f, 2.0, 0.6, 0.05, M.trimDark, x, 8.0, CB + 0.025);
            addLeaves(f, x, 1.05, 0.06);
            const orn = box(f, 0.22, 0.22, 0.03, M.gold, x, 8.0, CB + 0.06);
            orn.rotation.z = Math.PI / 4;
        }
        const gold = this.makeCharSign(['館', '史', '校'], 8.25, 1.0, '#d8a82e');   // 金色「校史館」（由右到左讀）
        gold.position.set(0, 5.0, CB + 0.09);
        f.add(gold);
        for (const x of [-0.8, 0, 0.8]) plane(f, winMat(1, 2), 0.5, 0.65, x, H + 1.35, 0.03);   // 山牆上三個小方窗

        this.scene.add(hall);
        const cos = Math.cos(theta), sin = Math.sin(theta);
        this.hall = {
            cx, cz, W, L, t, H, colliders, floorZones,
            toLocal: (x, z) => ({ x: (x - cx) * cos - (z - cz) * sin, z: (x - cx) * sin + (z - cz) * cos }),
            toWorld: (lx, lz) => ({ x: cx + lx * cos + lz * sin, z: cz - lx * sin + lz * cos })
        };
        this.buildings.push({
            mesh: hall, name: '校史館', interactive: true, footprint, mapColor: 0xd2bf94,
            walkway: null, tunnel: null, customCollision: true, height: H + 2.5
        });
    }

    // 校史館的牆、柱、石墩碰撞（都是區域座標下的長方形，門洞留空，所以走得進去）
    resolveHallCollisions(pos) {
        const h = this.hall;
        if (!h) return;
        const l = h.toLocal(pos.x, pos.z);
        if (Math.abs(l.x) > h.W / 2 + 7 || Math.abs(l.z) > h.L / 2 + 7) return;
        const r = this.playerRadius;
        let moved = false;
        for (let pass = 0; pass < 2; pass++) {
            for (const [x0, x1, z0, z1] of h.colliders) {
                const px = Math.max(x0, Math.min(x1, l.x)), pz = Math.max(z0, Math.min(z1, l.z));
                const dx = l.x - px, dz = l.z - pz, d = Math.hypot(dx, dz);
                if (d >= r) continue;
                if (d > 1e-6) { l.x = px + dx / d * (r + 0.001); l.z = pz + dz / d * (r + 0.001); }
                else {
                    const pl = l.x - x0, pr = x1 - l.x, pf = l.z - z0, pb = z1 - l.z, m = Math.min(pl, pr, pf, pb);
                    if (m === pl) l.x = x0 - r; else if (m === pr) l.x = x1 + r; else if (m === pf) l.z = z0 - r; else l.z = z1 + r;
                }
                moved = true;
            }
        }
        if (moved) { const w = h.toWorld(l.x, l.z); pos.x = w.x; pos.z = w.z; }
    }

    // ───────── 坡道／台階／欄杆：區域座標（edgeFrame 的 group）轉世界座標 ─────────
    _frame(g) { return { px: g.position.x, pz: g.position.z, c: Math.cos(g.rotation.y), s: Math.sin(g.rotation.y) }; }
    _toLocal(f, x, z) { const dx = x - f.px, dz = z - f.pz; return { x: dx * f.c - dz * f.s, z: dx * f.s + dz * f.c }; }
    _toWorld(f, lx, lz) { return { x: f.px + lx * f.c + lz * f.s, z: f.pz - lx * f.s + lz * f.c }; }
    // 可走表面：矩形範圍內，高度由 h(lx, lz) 決定（數字＝平台，函式＝坡道／台階）
    addWalkSurface(g, x0, x1, z0, z1, h) {
        const f = this._frame(g), cw = this._toWorld(f, (x0 + x1) / 2, (z0 + z1) / 2);
        this.surfaces.push({ f, x0, x1, z0, z1, h: typeof h === 'function' ? h : () => h, cx: cw.x, cz: cw.z, R: Math.hypot(x1 - x0, z1 - z0) / 2 + 1 });
    }
    // 擋人的長方體：玩家腳高低於 top - 0.2 就推開（欄杆、矮牆、販賣機…）
    addWalkBlocker(g, x0, x1, z0, z1, top) {
        const f = this._frame(g), cw = this._toWorld(f, (x0 + x1) / 2, (z0 + z1) / 2);
        this.blockers.push({ f, x0, x1, z0, z1, top, cx: cw.x, cz: cw.z, R: Math.hypot(x1 - x0, z1 - z0) / 2 + 1.5 });
    }
    addWalkColumn(g, lx, lz, r) { const w = this._toWorld(this._frame(g), lx, lz); this.columns.push({ x: w.x, z: w.z, r }); }
    getSurfaceY(x, z) {
        let y = 0;
        for (const sf of this.surfaces) {
            if (Math.abs(x - sf.cx) > sf.R || Math.abs(z - sf.cz) > sf.R) continue;
            const l = this._toLocal(sf.f, x, z);
            if (l.x < sf.x0 || l.x > sf.x1 || l.z < sf.z0 || l.z > sf.z1) continue;
            const v = sf.h(l.x, l.z);
            if (v > y) y = v;
        }
        return y;
    }
    getGroundY(x, z) { return Math.max(this.getFloorY(x, z), this.getSurfaceY(x, z)); }
    // 欄杆／矮牆：把玩家推開（跟校史館碰撞盒同一套算法）
    resolveBlockers(pos, footY) {
        const r = this.playerRadius;
        for (const b of this.blockers) {
            if (footY >= b.top - 0.2) continue;
            if (Math.abs(pos.x - b.cx) > b.R || Math.abs(pos.z - b.cz) > b.R) continue;
            const l = this._toLocal(b.f, pos.x, pos.z);
            const px = Math.max(b.x0, Math.min(b.x1, l.x)), pz = Math.max(b.z0, Math.min(b.z1, l.z));
            const dx = l.x - px, dz = l.z - pz, d = Math.hypot(dx, dz);
            if (d >= r) continue;
            if (d > 1e-6) { l.x = px + dx / d * (r + 0.001); l.z = pz + dz / d * (r + 0.001); }
            else {
                const pl = l.x - b.x0, pr = b.x1 - l.x, pf = l.z - b.z0, pb = b.z1 - l.z, m = Math.min(pl, pr, pf, pb);
                if (m === pl) l.x = b.x0 - r; else if (m === pr) l.x = b.x1 + r; else if (m === pf) l.z = b.z0 - r; else l.z = b.z1 + r;
            }
            const w = this._toWorld(b.f, l.x, l.z); pos.x = w.x; pos.z = w.z;
        }
    }
    // 這個位置（含前進方向多看一點）對現在腳高來說是不是「太高爬不上去」
    tooHigh(x, z, dx, dz, footY) {
        if (this.getSurfaceY(x, z) - footY > this.maxStep) return true;
        const d = Math.hypot(dx, dz);
        return d > 1e-6 && this.getSurfaceY(x + dx / d * 0.4, z + dz / d * 0.4) - footY > this.maxStep;
    }
    // 每一小步移動後呼叫：欄杆推開、太高的地方像撞牆（試著沿牆滑）
    applyWalkRules(p, ox, oz) {
        const footY = p.position.y - this.playerGround;
        this.resolveBlockers(p.position, footY);
        const nx = p.position.x, nz = p.position.z, dx = nx - ox, dz = nz - oz;
        if (!this.tooHigh(nx, nz, dx, dz, footY)) return;
        if (Math.abs(dx) > 1e-6 && !this.tooHigh(nx, oz, dx, 0, footY)) { p.position.x = nx; p.position.z = oz; }
        else if (Math.abs(dz) > 1e-6 && !this.tooHigh(ox, nz, 0, dz, footY)) { p.position.x = ox; p.position.z = nz; }
        else { p.position.x = ox; p.position.z = oz; }
    }

    // 校史館門檻、台階、室內地板的高度（其他地方回傳 0）
    getFloorY(x, z) {
        const h = this.hall;
        if (!h) return 0;
        const l = h.toLocal(x, z);
        let y = 0;
        for (const [x0, x1, z0, z1, hh] of h.floorZones) if (l.x >= x0 && l.x <= x1 && l.z >= z0 && l.z <= z1 && hh > y) y = hh;
        return y;
    }

    // 人在校史館裡面時，把鏡頭拉近，不要穿到牆外或屋頂外
    // 視線（玩家頭部 → 鏡頭）在建築高度以下第一次碰到牆的位置（0~1；1＝沒被擋）
    cameraHitT(target, cam) {
        const dx = cam.x - target.x, dy = cam.y - target.y, dz = cam.z - target.z;
        let k = 1;
        for (const b of this.buildings) {
            if (!b.footprint || !b.height) continue;
            const fp = b.footprint;
            if (b.walkway && target.x >= b.walkway.minX && target.x <= b.walkway.maxX && target.z >= b.walkway.minZ && target.z <= b.walkway.maxZ) continue;   // 人在走道裡
            if (this.isPointInPolygon(target.x, target.z, fp)) continue;                                                                                    // 人在樓內
            for (let i = 0; i < fp.length; i++) {
                const a = fp[i], c = fp[(i + 1) % fp.length];
                const ex = c.x - a.x, ez = c.z - a.z;
                const den = dx * ez - dz * ex;
                if (Math.abs(den) < 1e-9) continue;
                const t = ((a.x - target.x) * ez - (a.z - target.z) * ex) / den;
                const u = ((a.x - target.x) * dz - (a.z - target.z) * dx) / den;
                if (t <= 0 || t >= 1 || u < 0 || u > 1) continue;
                if (target.y + dy * t > b.height + 0.3) continue;                      // 視線在屋頂上方，沒被擋
                k = Math.min(k, t);
            }
        }
        return k;
    }

    // 鏡頭防穿牆：水平方向（你選的角度）不變，鏡頭離玩家的「總距離」也不變；
    // 但如果水平方向被牆擋住，鏡頭就沿著牆面往上爬、從上方斜斜往下看玩家（不縮短距離、不會放大、人不會消失）
    climbCameraOverWalls(target, cam, delta) {
        const dx = cam.x - target.x, dz = cam.z - target.z, dy = cam.y - target.y;
        const h0 = Math.hypot(dx, dz);
        if (h0 < 1e-6) return;
        const d3 = Math.hypot(h0, dy);
        const k = this.cameraHitT(target, cam);
        let want = 1;
        if (k < 1) want = Math.max(0.3, h0 * k - 0.35) / h0;                           // 水平方向最多退到牆前面一點點（至少 0.3 公尺，避免正上方）
        const prev = this._camK === undefined ? 1 : this._camK;
        const kk = want < prev ? want : Math.min(want, prev + 2.5 * delta);              // 被擋時馬上讓開，不被擋時慢慢退回
        this._camK = kk;
        if (kk >= 0.999) return;
        const h = h0 * kk;
        cam.x = target.x + dx * kk;
        cam.z = target.z + dz * kk;
        cam.y = target.y + Math.sqrt(Math.max(0.01, d3 * d3 - h * h));
    }

    fitCameraInHall(target, cam) {
        const h = this.hall;
        if (!h) return;
        const lt = h.toLocal(target.x, target.z);
        if (Math.abs(lt.x) > h.W / 2 - h.t - 0.05 || Math.abs(lt.z) > h.L / 2 - h.t - 0.05) return;   // 人在外面
        const lc = h.toLocal(cam.x, cam.z);
        const bx = h.W / 2 - h.t - 0.3, bz = h.L / 2 - h.t - 0.3, ymax = h.H - 0.3;
        const dx = lc.x - lt.x, dz = lc.z - lt.z, dy = cam.y - target.y;
        let k = 1;
        if (dx > 0 && lc.x > bx) k = Math.min(k, (bx - lt.x) / dx);
        if (dx < 0 && lc.x < -bx) k = Math.min(k, (-bx - lt.x) / dx);
        if (dz > 0 && lc.z > bz) k = Math.min(k, (bz - lt.z) / dz);
        if (dz < 0 && lc.z < -bz) k = Math.min(k, (-bz - lt.z) / dz);
        if (dy > 0 && cam.y > ymax) k = Math.min(k, (ymax - target.y) / dy);
        k = Math.max(0.12, k);
        cam.x = target.x + (cam.x - target.x) * k;
        cam.y = target.y + dy * k;
        cam.z = target.z + (cam.z - target.z) * k;
    }

    createMappedBuilding(name, coordinates, height, floors, color) {
        const style = this.getBuildingStyle(name);
        height = height * this.heightScale;
        const footprint = coordinates.map(([lon, lat]) => this.projectMapPoint(lon, lat));
        if (name === '校史館') { this.createHistoryHall(footprint, height); return; }   // 校史館：專用模型，門可進入
        const shape = this.footprintToShape(footprint);
        const arcadeHeight = 0; // 一樓一律砌實（牆從地面 0 公尺開始），不再做挑空騎樓
        const floorHeight = height / floors;
        const building = new THREE.Group();
        // 挑空走道（從大門直走會穿過莊敬樓、慎思樓底下的大空間）
        const tunnelCfg = { '莊敬樓': { x: -1.5, w: 16, floors: 1 }, '慎思樓': { x: -1.5, w: 14, floors: 2 } }[name];
        const tunnel = tunnelCfg ? this.makeTunnelInfo(footprint, tunnelCfg, floorHeight) : null;

        const roofMaterial = new THREE.MeshStandardMaterial({ color: style.roof, roughness: 0.95, side: THREE.DoubleSide });
        if (style.tiles) {
            // 每一層可以用不同的立面貼圖（一樓石材、上層陽台、拱窗層……）
            let start = 0;
            while (start < floors) {
                let end = start + 1;
                while (end < floors && style.tiles[end] === style.tiles[start]) end++;
                const tileStyle = Object.assign({}, style, { tile: style.tiles[start], tiles: undefined });
                const mat = new THREE.MeshStandardMaterial({ map: this.makeFacadeTexture(tileStyle), roughness: 0.85, side: THREE.DoubleSide });
                const top = end === floors;
                if (name === '麗澤樓') {
                    // 正面（中庭側）＝凹陽台；背面（照片）＝粉紅欄板＋窗帶；兩端山牆＝橘牆
                    const kinds = this.classifyLizeEdges(footprint);
                    const mk = t => new THREE.MeshStandardMaterial({ map: this.makeFacadeTexture(Object.assign({}, style, { tile: t, tiles: undefined })), roughness: 0.85, side: THREE.DoubleSide });
                    const y0 = start * floorHeight, y1 = top ? height : end * floorHeight;
                    this.addFootprintWalls(building, footprint, y0, y1, mat, roofMaterial, floorHeight, top, tunnel, i => kinds[i] === 'front');
                    this.addFootprintWalls(building, footprint, y0, y1, mk(start === 0 ? 'lizeBackG' : 'lizeBack'), roofMaterial, floorHeight, false, tunnel, i => kinds[i] === 'back');
                    this.addFootprintWalls(building, footprint, y0, y1, mk('lizeEnd'), roofMaterial, floorHeight, false, tunnel, i => kinds[i] === 'end');
                } else
                this.addFootprintWalls(building, footprint, start * floorHeight, top ? height : end * floorHeight, mat, roofMaterial, floorHeight, top, tunnel);
                start = end;
            }
        } else {
            const wallMaterial = new THREE.MeshStandardMaterial({ map: this.makeFacadeTexture(style), roughness: 0.85, side: THREE.DoubleSide });
            this.addFootprintWalls(building, footprint, arcadeHeight, height, wallMaterial, roofMaterial, floorHeight, true, tunnel);
        }

        if (arcadeHeight > 0) {
            const soffit = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 0.92, side: THREE.DoubleSide }));
            soffit.rotation.x = -Math.PI / 2;
            soffit.position.y = arcadeHeight - 0.08;
            building.add(soffit);
            this.addArcadeSupports(building, footprint, arcadeHeight);
        }

        // 每層飾帶（立體）＋ 女兒牆
        const levels = [];
        for (let f = Math.max(1, Math.ceil(arcadeHeight / floorHeight)); f < floors; f++) levels.push(f * floorHeight);
        this.addTrimBands(building, footprint, levels, style.bandThick, 0.22, style.band, tunnel);
        if (tunnel) this.buildTunnel(building, tunnel, style, name, floorHeight);
        if (name !== '校史館') {
            this.addTrimBands(building, footprint, [height + 0.6], 0.6, 0.3, this.mixColor(style.wall, 0xffffff, 0.25));
            this.addRoofProps(building, footprint, height, style, name);
        }
        this.scene.add(building);
        if (arcadeHeight === 0 && !tunnel && !['莊敬樓', '麗澤樓', '科學館'].includes(name)) this.addEntrance(footprint, style, name === '校史館');

        if (name === '校史館') this.addHistoryHallRoof(footprint, height, style);
        if (name === '莊敬樓') this.addZhuangjingPortico(footprint, height);
        if (name === '慎思樓') this.addShensiFacade(footprint, height, floors);
        if (name === '景賢樓') { this.addJingxianFacade(footprint, height, floors); this.addTianxinObservatory(footprint, height); }
        if (name === '麗澤樓') { this.addLizeDetails(footprint, height, floors); this.addLizeBack(footprint); }
        if (name === '體育運動館') this.addPEDetails(footprint, height);
        if (name === '科學館') this.addScienceEntrance(footprint, height);
        if (!['慎思樓', '莊敬樓', '麗澤樓', '科學館', '體育運動館'].includes(name)) this.addBuildingNameplate(name, footprint, height);

        this.buildings.push({
            mesh: building,
            name,
            interactive: true,
            footprint,
            height,
            mapColor: style.wall,
            walkway: tunnel ? tunnel.walkway : (arcadeHeight ? this.getArcadeBounds(footprint, name === '慎思樓' ? 5 : 4.5) : null),
            tunnel
        });
    }

    // 計算挑空走道：沿 z 方向穿過整棟樓的長方形通道（寬 w、高 floors 層）
    makeTunnelInfo(footprint, cfg, floorHeight) {
        const minX = cfg.x - cfg.w / 2, maxX = cfg.x + cfg.w / 2;
        const zAt = (x) => {
            const zs = [];
            for (let i = 0; i < footprint.length; i++) {
                const a = footprint[i], b = footprint[(i + 1) % footprint.length];
                if (Math.abs(b.x - a.x) < 1e-6) continue;
                if ((a.x - x) * (b.x - x) <= 0) zs.push(a.z + (x - a.x) / (b.x - a.x) * (b.z - a.z));
            }
            return zs.length ? { lo: Math.min(...zs), hi: Math.max(...zs) } : null;
        };
        const l = zAt(minX), c = zAt(cfg.x), r = zAt(maxX);
        const ends = [l, c, r].filter(Boolean);
        const zmin = Math.min(...ends.map(e => e.lo)), zmax = Math.max(...ends.map(e => e.hi));
        return {
            minX, maxX, x: cfg.x, height: floorHeight * cfg.floors, zmin, zmax,
            front: { z0: l.lo, z1: r.lo },   // 面向校門那面牆在通道左右邊緣的 z
            back: { z0: l.hi, z1: r.hi },
            walkway: { minX, maxX, minZ: zmin - 0.6, maxZ: zmax + 0.6 }
        };
    }

    // 把一條邊依通道範圍切成最多三段；通道內那段只從通道頂往上畫
    splitEdgeByTunnel(a, b, tunnel) {
        const ts = [0, 1], dx = b.x - a.x;
        if (tunnel && Math.abs(dx) > 1e-6) for (const xe of [tunnel.minX, tunnel.maxX]) { const t = (xe - a.x) / dx; if (t > 0 && t < 1) ts.push(t); }
        ts.sort((p, q) => p - q);
        const out = [];
        for (let k = 0; k < ts.length - 1; k++) {
            const t0 = ts[k], t1 = ts[k + 1], xm = a.x + dx * (t0 + t1) / 2;
            out.push({ t0, t1, inside: !!tunnel && xm >= tunnel.minX && xm <= tunnel.maxX });
        }
        return out;
    }

    addFootprintWalls(group, footprint, baseHeight, height, material, roofMaterial = material, floorHeight = 3.5, withRoof = true, tunnel = null, edgeFilter = null) {
        const pos = [], uv = [];
        let run = 0;
        for (let i = 0; i < footprint.length; i++) {
            const a = footprint[i], b = footprint[(i + 1) % footprint.length];
            const len = Math.hypot(b.x - a.x, b.z - a.z);
            if (edgeFilter && !edgeFilter(i)) { run += len; continue; }   // 只畫被選中的牆（麗澤樓正面／背面／山牆用不同貼圖）
            for (const sg of this.splitEdgeByTunnel(a, b, tunnel)) {
                const low = sg.inside ? Math.max(baseHeight, tunnel.height) : baseHeight;
                if (low >= height - 0.01) continue;
                const p0 = { x: a.x + (b.x - a.x) * sg.t0, z: a.z + (b.z - a.z) * sg.t0 };
                const p1 = { x: a.x + (b.x - a.x) * sg.t1, z: a.z + (b.z - a.z) * sg.t1 };
                const u0 = (run + len * sg.t0) / 8, u1 = (run + len * sg.t1) / 8, v0 = low / floorHeight, v1 = height / floorHeight;
                pos.push(p0.x, low, p0.z, p1.x, low, p1.z, p1.x, height, p1.z, p0.x, low, p0.z, p1.x, height, p1.z, p0.x, height, p0.z);
                uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
            }
            run += len;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geometry.computeVertexNormals();
        const walls = new THREE.Mesh(geometry, material);
        walls.castShadow = true; walls.receiveShadow = true;
        group.add(walls);

        if (!withRoof) return;
        const roofGeometry = new THREE.ShapeGeometry(this.footprintToShape(footprint));
        roofGeometry.rotateX(-Math.PI / 2);
        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.y = height;
        roof.receiveShadow = true;
        group.add(roof);
    }

    addTrimBands(group, footprint, levels, thick, depth, color, tunnel = null) {
        if (!levels.length || !thick) return;
        const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }), footprint.length * levels.length * 3);
        const o = new THREE.Object3D();
        let i = 0;
        for (let e = 0; e < footprint.length; e++) {
            const a = footprint[e], b = footprint[(e + 1) % footprint.length];
            if (Math.hypot(b.x - a.x, b.z - a.z) < 0.5) continue;
            for (const sg of this.splitEdgeByTunnel(a, b, tunnel)) {
                const p0 = { x: a.x + (b.x - a.x) * sg.t0, z: a.z + (b.z - a.z) * sg.t0 };
                const p1 = { x: a.x + (b.x - a.x) * sg.t1, z: a.z + (b.z - a.z) * sg.t1 };
                const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
                if (len < 0.1) continue;
                for (const y of levels) {
                    if (sg.inside && y < tunnel.height - 0.01) continue;   // 通道開口不要被飾帶橫著擋住
                    o.position.set((p0.x + p1.x) / 2, y - thick / 2, (p0.z + p1.z) / 2);
                    o.rotation.set(0, Math.atan2(-(p1.z - p0.z), p1.x - p0.x), 0);
                    o.scale.set(len + 0.05, thick, depth * 2);
                    o.updateMatrix();
                    mesh.setMatrixAt(i++, o.matrix);
                }
            }
        }
        mesh.count = i;
        mesh.castShadow = true;
        mesh.instanceMatrix.needsUpdate = true;
        group.add(mesh);
    }

    // 挑空走道內部：地板、天花板（肋樑＋燈）、兩側牆、前後的灰色門框，慎思樓前面再加白色圓柱
    buildTunnel(group, t, style, name, floorHeight) {
        const W = t.maxX - t.minX, H = t.height, cx = (t.minX + t.maxX) / 2;
        const zl = t.zmin - 0.3, zh = t.zmax + 0.3, D = zh - zl, cz = (zl + zh) / 2;
        const concrete = new THREE.MeshStandardMaterial({ color: name === '慎思樓' ? 0xa9a8a2 : 0xd9d5cb, roughness: 0.9, side: THREE.DoubleSide });
        const floorMat = new THREE.MeshStandardMaterial({ color: 0xbdb7aa, roughness: 0.95 });
        const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
        const add = (geo, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; group.add(m); return m; };
        // 地板（磨石子地磚＋中央導引線）
        const fl = add(new THREE.BoxGeometry(W, 0.12, D), floorMat, cx, 0.06, cz);
        fl.castShadow = false;
        add(new THREE.BoxGeometry(0.12, 0.02, D), new THREE.MeshStandardMaterial({ color: 0xe9e3d3, roughness: 0.9 }), cx, 0.13, cz).castShadow = false;
        // 天花板＋橫向肋樑＋燈條
        add(new THREE.BoxGeometry(W, 0.3, D), concrete, cx, H - 0.15, cz);
        const nb = Math.max(2, Math.round(D / 3.2));
        for (let i = 0; i <= nb; i++) {
            const z = zl + 0.4 + (D - 0.8) * i / nb;
            add(new THREE.BoxGeometry(W, 0.45, 0.4), concrete, cx, H - 0.5, z);
            if (i < nb) for (const sx of [-0.28, 0.28]) {
                const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.28), lightMat);
                lamp.position.set(cx + sx * W, H - 0.74, z + (D - 0.8) / nb / 2); group.add(lamp);
            }
        }
        // 兩側牆（走道內側）
        for (const x of [t.minX, t.maxX]) add(new THREE.BoxGeometry(0.4, H, D), concrete, x + (x === t.minX ? -0.2 : 0.2), H / 2, cz);
        // 前後門框：兩側厚實的灰色牆柱＋上方橫樑（跟著牆面的斜度）
        const frameMat = new THREE.MeshStandardMaterial({ color: name === '慎思樓' ? 0x9a9ea0 : 0xcfccc2, roughness: 0.85 });
        for (const [e, dir] of [[t.front, -1], [t.back, 1]]) {
            const zc = (e.z0 + e.z1) / 2, ry = Math.atan2(-(e.z1 - e.z0), W);
            const zo = zc + dir * 0.35;
            for (const sx of [-1, 1]) add(new THREE.BoxGeometry(1.5, H + 1.4, 1.1), frameMat, cx + sx * (W / 2 + 0.75), (H + 1.4) / 2, zo + (sx > 0 ? (e.z1 - zc) : (e.z0 - zc)));
            add(new THREE.BoxGeometry(W + 3.0, 1.4, 1.1), frameMat, cx, H + 0.7, zo, ry);
        }
        // 慎思樓：正面入口前一根白色大圓柱（照片中央那根）
        if (name === '慎思樓') {
            const colMat = new THREE.MeshStandardMaterial({ color: 0xf1eee6, roughness: 0.6 });
            const cxp = cx + W * 0.2, czp = t.front.z0 + 1.6;
            add(new THREE.CylinderGeometry(0.6, 0.64, H, 24), colMat, cxp, H / 2, czp);
            this.columns.push({ x: cxp, z: czp, r: 0.64 });
        }
    }

    randomPointInside(footprint, rand, margin) {
        const xs = footprint.map(p => p.x), zs = footprint.map(p => p.z);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
        for (let t = 0; t < 40; t++) {
            const x = minX + rand() * (maxX - minX), z = minZ + rand() * (maxZ - minZ);
            if (!this.isPointInPolygon(x, z, footprint)) continue;
            const c = this.closestPointOnPolygon(x, z, footprint);
            if (Math.hypot(c.x - x, c.z - z) >= margin) return { x, z };
        }
        return null;
    }

    // 屋頂：樓梯間、水塔、冷氣主機（台灣學校屋頂的標配）
    addRoofProps(group, footprint, height, style, name) {
        const rand = this.seededRandom(name);
        const wallLight = new THREE.MeshStandardMaterial({ color: this.mixColor(style.wall, 0xffffff, 0.2), roughness: 0.9 });
        const grey = new THREE.MeshStandardMaterial({ color: 0xb9bdc2, roughness: 0.6, metalness: 0.2 });
        const tankMat = new THREE.MeshStandardMaterial({ color: 0xe8eef2, roughness: 0.5 });
        let p = this.randomPointInside(footprint, rand, 3);
        if (p) {
            const stair = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.8, 3.4), wallLight);
            stair.position.set(p.x, height + 1.4, p.z); stair.castShadow = true; group.add(stair);
        }
        for (let i = 0; i < 2; i++) {
            p = this.randomPointInside(footprint, rand, 2);
            if (!p) continue;
            const stand = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.6), grey);
            stand.position.set(p.x, height + 0.25, p.z);
            const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.9, 16), tankMat);
            tank.position.set(p.x, height + 1.45, p.z); tank.castShadow = true;
            group.add(stand, tank);
        }
        for (let i = 0; i < 5; i++) {
            p = this.randomPointInside(footprint, rand, 1.5);
            if (!p) continue;
            const ac = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 1), grey);
            ac.position.set(p.x, height + 0.5, p.z); ac.rotation.y = rand() * 3; ac.castShadow = true; group.add(ac);
        }
    }

    // 景賢樓：仿老紅樓的兩座衛塔（白飾帶＋墨綠尖頂）
    addJingxianTowers(footprint, height) {
        const front = this.getFrontEdge(footprint);
        if (!front) return;
        const dx = front.end.x - front.start.x, dz = front.end.z - front.start.z;
        const len = Math.hypot(dx, dz), rot = Math.atan2(-dz, dx);
        const brick = new THREE.MeshStandardMaterial({ color: 0xb4483a, roughness: 0.9 });
        const white = new THREE.MeshStandardMaterial({ color: 0xf4ecdc, roughness: 0.7 });
        const roofMat = new THREE.MeshStandardMaterial({ color: 0x2f5d4f, roughness: 0.6 });
        for (const r of [0.1, 0.9]) {
            const x = front.start.x + dx * r - front.nx * 1.4, z = front.start.z + dz * r - front.nz * 1.4;
            const th = 6.5, w = Math.min(4.2, len * 0.14);
            const body = new THREE.Mesh(new THREE.BoxGeometry(w, th, w), brick);
            body.position.set(x, height + th / 2, z); body.rotation.y = rot;
            const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.45, w + 0.5), white);
            cap.position.set(x, height + th, z); cap.rotation.y = rot;
            const mid = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.3, w + 0.3), white);
            mid.position.set(x, height + th * 0.45, z); mid.rotation.y = rot;
            const pyr = new THREE.Mesh(new THREE.ConeGeometry(w * 0.82, 3.2, 4), roofMat);
            pyr.position.set(x, height + th + 1.85, z); pyr.rotation.y = rot + Math.PI / 4;
            body.castShadow = pyr.castShadow = true;
            this.scene.add(body, cap, mid, pyr);
            // 紅樓衛塔語彙：白色仿石隅石＋牛眼盲窗（凌宗魁《老紅樓建築評析》）
            const tg = new THREE.Group();
            tg.position.set(x, height, z); tg.rotation.y = rot;
            const sgn = ((-dz / len) * front.nx + (dx / len) * front.nz) >= 0 ? 1 : -1;
            for (let q = 0; q < 8; q++) for (const cx of [-1, 1]) for (const cz of [-1, 1]) {
                const alongX = q % 2 === 0;
                const qb = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.95 : 0.5, 0.42, alongX ? 0.5 : 0.95), white);
                qb.position.set(cx * (w / 2 - (alongX ? 0.45 : 0.2)), 0.4 + q * 0.78, cz * (w / 2 - (alongX ? 0.2 : 0.45)));
                tg.add(qb);
            }
            for (const face of [1, -1]) {
                const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.68, 24), white);
                const eye = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), new THREE.MeshStandardMaterial({ color: 0x2d4650, roughness: 0.3 }));
                for (const m of [ring, eye]) { m.position.set(0, th * 0.62, face * sgn * (w / 2 + 0.03)); if (face * sgn < 0) m.rotation.y = Math.PI; tg.add(m); }
            }
            this.scene.add(tg);
        }
    }

    // 景賢樓 7 樓「天信天文台」圓頂
    addTianxinObservatory(footprint, height) {
        const front = this.getFrontEdge(footprint);
        if (!front) return;
        const mx = (front.start.x + front.end.x) / 2 - front.nx * 5;
        const mz = (front.start.z + front.end.z) / 2 - front.nz * 5;
        const base = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 2.4, 24), new THREE.MeshStandardMaterial({ color: 0xf1ece0, roughness: 0.7 }));
        base.position.set(mx, height + 1.2, mz);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(2.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xdfe5ea, roughness: 0.3, metalness: 0.4 }));
        dome.position.set(mx, height + 2.4, mz);
        base.castShadow = dome.castShadow = true;
        this.scene.add(base, dome);
    }

    // 取多邊形最長的對角線當作主軸，回傳 {A, B, u, n}；B 端較偏東
    getLongAxis(footprint) {
        let best = null;
        for (let i = 0; i < footprint.length; i++) for (let j = i + 1; j < footprint.length; j++) {
            const d = Math.hypot(footprint[i].x - footprint[j].x, footprint[i].z - footprint[j].z);
            if (!best || d > best.d) best = { a: footprint[i], b: footprint[j], d };
        }
        const o = this.projectMapPoint(120.6862, 24.1505), e = this.projectMapPoint(120.6863, 24.1505);
        let A = best.a, B = best.b;
        if ((B.x - A.x) * (e.x - o.x) + (B.z - A.z) * (e.z - o.z) < 0) { const t = A; A = B; B = t; }
        const len = Math.hypot(B.x - A.x, B.z - A.z);
        const u = { x: (B.x - A.x) / len, z: (B.z - A.z) / len };
        const front = this.getFrontEdge(footprint);
        let n = { x: -u.z, z: u.x };
        if (front && n.x * front.nx + n.z * front.nz < 0) n = { x: -n.x, z: -n.z };
        return { A, B, u, n, len };
    }

    // 每個邊向外的法線（用「往外推一點是否在多邊形內」判斷，U 形中庭也正確）
    edgeOutward(footprint, a, b) {
        const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
        let nx = -dz / l, nz = dx / l;
        if (this.isPointInPolygon((a.x + b.x) / 2 + nx * 0.4, (a.z + b.z) / 2 + nz * 0.4, footprint)) { nx = -nx; nz = -nz; }
        return { nx, nz, l };
    }

    // 慎思樓（照片）：深紅磚牆＋白色水平飾帶；二～三樓一排白框圓拱窗；一樓是白柱挑空；
    // 最頂層是白色欄杆的開放走廊；東端有兩片灰色清水混凝土高牆，夾著直書「慎思樓」。
    addShensiFacade(footprint, height, floors) {
        const ax = this.getLongAxis(footprint);
        const white = new THREE.MeshStandardMaterial({ color: 0xf2eee4, roughness: 0.7 });
        const gray = new THREE.MeshStandardMaterial({ color: 0x8d9094, roughness: 0.9 });
        // 沿所有外牆：頂層白色欄杆（女兒牆上方細欄杆）
        const rail = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.9, 0.07), white, 900);
        const o = new THREE.Object3D(); let k = 0;
        for (let i = 0; i < footprint.length; i++) {
            const a = footprint[i], b = footprint[(i + 1) % footprint.length];
            const { nx, nz, l } = this.edgeOutward(footprint, a, b);
            if (l < 2) continue;
            const n = Math.floor(l / 0.5);
            for (let j = 0; j <= n && k < 900; j++) {
                const t = j / n;
                o.position.set(a.x + (b.x - a.x) * t + nx * 0.15, height + 1.15, a.z + (b.z - a.z) * t + nz * 0.15);
                o.updateMatrix(); rail.setMatrixAt(k++, o.matrix);
            }
        }
        rail.count = k; rail.instanceMatrix.needsUpdate = true; this.scene.add(rail);

        // 東端灰色高塔（兩片牆夾一道紅磚）
        const tg = new THREE.Group();
        const fz = Math.max(...footprint.filter(p => Math.hypot(p.x - ax.B.x, p.z - ax.B.z) < 10).map(p => (p.x - ax.B.x) * ax.n.x + (p.z - ax.B.z) * ax.n.z));
        tg.position.set(ax.B.x - ax.u.x * 1.6 + ax.n.x * (fz - 0.1), 0, ax.B.z - ax.u.z * 1.6 + ax.n.z * (fz - 0.1));
        tg.rotation.y = Math.atan2(-ax.u.z, ax.u.x);
        const lz = { x: Math.sin(tg.rotation.y), z: Math.cos(tg.rotation.y) };
        if (lz.x * ax.n.x + lz.z * ax.n.z < 0) tg.rotation.y += Math.PI;   // 讓區域 +z 朝外
        const H = height + 3;
        for (const sx of [-1.7, 1.7]) {
            const slab = new THREE.Mesh(new THREE.BoxGeometry(1.2, H, 1.4), gray);
            slab.position.set(sx, H / 2, 0.3); slab.castShadow = true; tg.add(slab);
        }
        const cap = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.4, 1.5), white);
        cap.position.set(0, H - 0.1, 0.3); tg.add(cap);
        // 直書校名（白字灰底）＋頂端紅色徽章
        const sign = this.textPlane('慎\n思\n樓', 0.95, 4.0, '#8d9094', '#ffffff', 150);
        const c = document.createElement('canvas'); c.width = 256; c.height = 1024;
        const x = c.getContext('2d'); x.fillStyle = '#8d9094'; x.fillRect(0, 0, 256, 1024);
        x.fillStyle = '#ffffff'; x.font = 'bold 190px Microsoft JhengHei, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
        ['慎', '思', '樓'].forEach((ch, i) => x.fillText(ch, 128, 160 + i * 300));
        const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
        sign.material = new THREE.MeshBasicMaterial({ map: tex });
        sign.position.set(-1.7, height * 0.58, 1.02); tg.add(sign);
        const logo = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), new THREE.MeshBasicMaterial({ color: 0xc83030 }));
        logo.position.set(-1.7, H - 1.0, 1.02); tg.add(logo);
        this.scene.add(tg);
    }

    // 景賢樓（照片）：灰色清水混凝土樓板＋一排排「紅磚直柱」夾著白欄杆陽台；一樓灰色柱廊；
    // 正面屋頂中央一座紅磚三角山牆（三扇小窗）；中庭有樹與花台。
    addJingxianFacade(footprint, height, floors) {
        const brick = new THREE.MeshStandardMaterial({ color: 0xa6473a, roughness: 0.92 });
        const white = new THREE.MeshStandardMaterial({ color: 0xf2eee4, roughness: 0.7 });
        const grayM = new THREE.MeshStandardMaterial({ color: 0x9fa09c, roughness: 0.9 });
        const pierH = height - 3.2;
        const piers = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, pierH, 0.6), brick, 400);
        const o = new THREE.Object3D(); let k = 0;
        for (let i = 0; i < footprint.length; i++) {
            const a = footprint[i], b = footprint[(i + 1) % footprint.length];
            const { nx, nz, l } = this.edgeOutward(footprint, a, b);
            if (l < 5) continue;
            const n = Math.max(1, Math.round(l / 3.6));
            for (let j = 0; j <= n && k < 400; j++) {
                const t = j / n;
                o.position.set(a.x + (b.x - a.x) * t + nx * 0.3, 3.2 + pierH / 2, a.z + (b.z - a.z) * t + nz * 0.3);
                o.rotation.set(0, Math.atan2(-(b.z - a.z), b.x - a.x), 0);
                o.updateMatrix(); piers.setMatrixAt(k++, o.matrix);
            }
        }
        piers.count = k; piers.castShadow = true; piers.instanceMatrix.needsUpdate = true; this.scene.add(piers);
        // 一樓灰色柱廊
        const cols = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.3, 3.2, 12), grayM, 200);
        let c = 0;
        for (let i = 0; i < footprint.length; i++) {
            const a = footprint[i], b = footprint[(i + 1) % footprint.length];
            const { nx, nz, l } = this.edgeOutward(footprint, a, b);
            if (l < 5) continue;
            const n = Math.max(1, Math.round(l / 4.5));
            for (let j = 0; j <= n && c < 200; j++) {
                const t = j / n;
                o.position.set(a.x + (b.x - a.x) * t + nx * 0.7, 1.6, a.z + (b.z - a.z) * t + nz * 0.7);
                o.rotation.set(0, 0, 0); o.updateMatrix(); cols.setMatrixAt(c++, o.matrix);
            }
        }
        cols.count = c; cols.castShadow = true; cols.instanceMatrix.needsUpdate = true; this.scene.add(cols);

        // 正面中央紅磚山牆
        const f = this.getFrontEdge(footprint);
        if (f) {
            const tg = new THREE.Group();
            tg.position.set((f.start.x + f.end.x) / 2 - f.nx * 0.9, height, (f.start.z + f.end.z) / 2 - f.nz * 0.9);
            tg.rotation.y = Math.atan2(f.nx, f.nz);
            const tri = new THREE.Shape(); tri.moveTo(-5, 0); tri.lineTo(5, 0); tri.lineTo(0, 3.6); tri.closePath();
            const gab = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 1.2, bevelEnabled: false }), brick);
            gab.position.z = -0.6; gab.castShadow = true; tg.add(gab);
            const edge = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 0.2, bevelEnabled: false }), white);
            edge.scale.set(1.04, 1.04, 1); edge.position.set(0, -0.05, 0.62); tg.add(edge);
            for (const wx of [-1.5, 0, 1.5]) {
                const win = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.1), new THREE.MeshStandardMaterial({ color: 0x2f4650, roughness: 0.2 }));
                win.position.set(wx, 1.0, 0.84); tg.add(win);
            }
            this.scene.add(tg);
        }
    }

    footprintToShape(footprint) {
        const shape = new THREE.Shape();
        footprint.forEach((point, index) => {
            if (index === 0) shape.moveTo(point.x, -point.z);
            else shape.lineTo(point.x, -point.z);
        });
        shape.closePath();
        return shape;
    }

    getArcadeBounds(footprint, width) {
        const minX = Math.min(...footprint.map(point => point.x));
        const maxX = Math.max(...footprint.map(point => point.x));
        const minZ = Math.min(...footprint.map(point => point.z));
        const maxZ = Math.max(...footprint.map(point => point.z));
        const centerX = (minX + maxX) / 2;
        return { minX: centerX - width / 2, maxX: centerX + width / 2, minZ: minZ - 0.5, maxZ: maxZ + 0.5 };
    }

    addArcadeSupports(group, footprint, height) {
        const material = new THREE.MeshStandardMaterial({ color: 0xece8de, roughness: 0.7 });
        const walkway = this.getArcadeBounds(footprint, 5);
        const addColumn = (x, z) => {
            const column = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, height, 16), material);
            column.position.set(x, height / 2, z);
            column.castShadow = true;
            group.add(column);
        };
        for (let index = 0; index < footprint.length; index++) {
            const start = footprint[index], end = footprint[(index + 1) % footprint.length];
            const dx = end.x - start.x, dz = end.z - start.z;
            const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 7));
            for (let step = 0; step <= steps; step++) {
                const ratio = step / steps;
                const x = start.x + dx * ratio, z = start.z + dz * ratio;
                const atPassageMouth = x >= walkway.minX - 0.4 && x <= walkway.maxX + 0.4 &&
                    (z < walkway.minZ + 2 || z > walkway.maxZ - 2);
                if (!atPassageMouth) addColumn(x, z);
            }
        }
        const centerX = (walkway.minX + walkway.maxX) / 2;
        const centerZ = (walkway.minZ + walkway.maxZ) / 2;
        const minZ = Math.min(...footprint.map(point => point.z));
        const maxZ = Math.max(...footprint.map(point => point.z));
        const passage = new THREE.Mesh(new THREE.PlaneGeometry(walkway.maxX - walkway.minX, maxZ - minZ), new THREE.MeshStandardMaterial({ color: 0xb9b4a9, roughness: 0.92 }));
        passage.rotation.x = -Math.PI / 2;
        passage.position.set(centerX, 0.045, centerZ);
        group.add(passage);
    }

    // 校史館（原「第一中學校講堂」，1937）：磚造、單層、二落水（雙坡）屋頂，正面有小型入口門廊
    addHistoryHallRoof(footprint, height, style) {
        if (footprint.length !== 4) return;
        let f = footprint.slice();
        const len = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
        if (len(f[0], f[1]) < len(f[1], f[2])) f = [f[1], f[2], f[3], f[0]];
        const [a, b, c, d] = f;                          // a→b、d→c 為長邊
        const mid = (p, q) => ({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 });
        const ra = mid(d, a), rb = mid(b, c);
        const cx = (a.x + b.x + c.x + d.x) / 4, cz = (a.z + b.z + c.z + d.z) / 4;
        const eave = (p, k) => { const l = Math.hypot(p.x - cx, p.z - cz) || 1; return { x: p.x + (p.x - cx) / l * k, z: p.z + (p.z - cz) / l * k }; };
        const span = len(a, d), rise = span * 0.23;
        const ey = height - 0.1, ry = height + rise;
        const A = eave(a, 0.6), B = eave(b, 0.6), C = eave(c, 0.6), D = eave(d, 0.6);
        const RA = { ...eave(ra, 0.6), y: ry }, RB = { ...eave(rb, 0.6), y: ry };
        const quad = (p, q, r, t) => [p, q, r, p, r, t].flatMap(v => [v.x, v.y, v.z]);
        const pt = (p, y) => ({ x: p.x, y, z: p.z });
        const roofVerts = [...quad(pt(A, ey), pt(B, ey), RB, RA), ...quad(pt(D, ey), pt(C, ey), RB, RA)];
        const rg = new THREE.BufferGeometry();
        rg.setAttribute('position', new THREE.Float32BufferAttribute(roofVerts, 3));
        rg.computeVertexNormals();
        const roof = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: style.roof, roughness: 0.85, side: THREE.DoubleSide }));
        roof.castShadow = true;
        this.scene.add(roof);
        // 山牆（兩端磚牆三角形）
        const gv = [a, d, ra, b, c, rb].map((p, i) => [p.x, (i % 3 === 2) ? ry - 0.2 : height, p.z]).flat();
        const gg = new THREE.BufferGeometry();
        gg.setAttribute('position', new THREE.Float32BufferAttribute(gv, 3));
        gg.computeVertexNormals();
        const gable = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ color: style.wall, roughness: 0.9, side: THREE.DoubleSide }));
        this.scene.add(gable);
        // 屋脊
        const ridge = new THREE.Mesh(new THREE.BoxGeometry(len(RA, RB) + 1.2, 0.35, 0.5), new THREE.MeshStandardMaterial({ color: 0x35302e, roughness: 0.8 }));
        ridge.position.set((RA.x + RB.x) / 2, ry + 0.1, (RA.z + RB.z) / 2);
        ridge.rotation.y = Math.atan2(-(RB.z - RA.z), RB.x - RA.x);
        this.scene.add(ridge);
    }

    // 入口：玻璃門、雨庇、台階（校史館用較大的門廊與木門）
    addEntrance(footprint, style, porch = false) {
        const front = this.getFrontEdge(footprint);
        if (!front) return;
        const g = new THREE.Group();
        g.position.set((front.start.x + front.end.x) / 2, 0, (front.start.z + front.end.z) / 2);
        g.rotation.y = Math.atan2(front.nx, front.nz);   // 區域 +z = 朝外
        const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.5, metalness: 0.4 });
        const glass = new THREE.MeshStandardMaterial({ color: porch ? 0x5a3b28 : 0x6fa0b8, roughness: porch ? 0.8 : 0.15, metalness: porch ? 0 : 0.3 });
        const trim = new THREE.MeshStandardMaterial({ color: style.band, roughness: 0.8 });
        const w = porch ? 2.8 : 3.4;
        const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
        add(new THREE.BoxGeometry(w, 3.0, 0.2), metal, 0, 1.5, 0.1);
        add(new THREE.BoxGeometry(w / 2 - 0.15, 2.7, 0.12), glass, -w / 4, 1.4, 0.2);
        add(new THREE.BoxGeometry(w / 2 - 0.15, 2.7, 0.12), glass, w / 4, 1.4, 0.2);
        const cw = porch ? 6.4 : 5.2, cd = porch ? 3.4 : 2.2;
        add(new THREE.BoxGeometry(cw, 0.25, cd), trim, 0, 3.4, cd / 2);
        const px = cw / 2 - 0.2, pz = cd - 0.25;
        if (porch) { for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(0.22, 0.26, 3.3, 14), trim, sx * px, 1.65, pz); }
        else { for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(0.07, 0.07, 3.3, 8), metal, sx * px, 1.65, pz); }
        for (let i = 0; i < 3; i++) {
            const h = 0.14 * (3 - i);
            const zc = 0.4 + i * 0.5 + (porch ? 0.6 : 0);
            add(new THREE.BoxGeometry(cw - 0.4, h, 0.5), new THREE.MeshStandardMaterial({ color: 0xb9b5aa, roughness: 0.95 }), 0, h / 2, zc);
            this.addWalkSurface(g, -(cw - 0.4) / 2, (cw - 0.4) / 2, zc - 0.25, zc + 0.25, h);
        }
        for (const sx of [-1, 1]) this.addWalkColumn(g, sx * px, pz, porch ? 0.26 : 0.07);
        this.scene.add(g);
    }

    // 莊敬樓門面（照片）：鏡面鋼構＋綠色玻璃雨庇（底下有三角桁架）、兩側黑色圓柱、大階梯、暗色玻璃大門。
    // 校名「莊敬樓」是白色欄板上的深棕紅色字（由右到左）。注意：照片中的紅布條「不要」做。
    addZhuangjingPortico(footprint, height) {
        const front = this.getFrontEdge(footprint);
        if (!front) return;
        const { g, add } = this.edgeFrame(front, 0.5);
        const steel = new THREE.MeshStandardMaterial({ color: 0xcfd5d8, metalness: 0.85, roughness: 0.25, envMap: this.getMirrorEnv(), envMapIntensity: 1.0 });
        const black = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, metalness: 0.6, roughness: 0.35 });
        const darkGreen = new THREE.MeshStandardMaterial({ color: 0x35453f, roughness: 0.6 });
        const doorDark = new THREE.MeshStandardMaterial({ color: 0x1f262a, roughness: 0.25, metalness: 0.3 });
        const frame = new THREE.MeshStandardMaterial({ color: 0xcfd3d4, roughness: 0.5, metalness: 0.5 });
        // 一樓已改成挑空走道，不再放玻璃大門／雨庇／階梯

        // 校名：白色欄板上的深棕紅字（頂樓欄板），由右到左 = 樓敬莊
        const topFloorBase = height * 3 / 4, fh = height / 4;
        const name = this.charPlane(['樓', '敬', '莊'], 28, 1.5, '#6c2b27');
        name.position.set(0, topFloorBase + fh * 0.30, 0.1);
        g.add(name);
        this.scene.add(g);
    }

    // 「飛龍乘雲」：灰色牆板上的白色浮雕龍。依實景照片重畫：
    // 頭在中央偏下朝左（魚形大頭、螺旋眼、往右流動的鬃毛），上方 S 形背脊帶一排尖刺，
    // 頂端火焰狀鬃毛與右上圓耳，右側雲渦，下方一大圈盤繞的身軀與尾、左側火焰尾與爪、底部雲座。
    // 同時畫一張高度圖（模糊後當 bumpMap），讓白色塊面真的有「浮起來」的立體感。
    makeDragonTexture() {
        if (this._dragonTex) return this._dragonTex;
        const CW = 1024, CH = 2048, S = 0.92, OX = (CW - 840 * S) / 2, OY = 520;
        const mk = () => { const c = document.createElement('canvas'); c.width = CW; c.height = CH; return c; };
        const col = mk(), hgt = mk(), gc = col.getContext('2d'), gh = hgt.getContext('2d');
        gc.fillStyle = '#9c9d9b'; gc.fillRect(0, 0, CW, CH);
        gh.fillStyle = '#000'; gh.fillRect(0, 0, CW, CH);
        const X = x => OX + x * S, Y = y => OY + y * S;
        // Catmull-Rom 取樣
        const spline = (pts, step = 3) => {
            const out = [];
            for (let i = 0; i < pts.length - 1; i++) {
                const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
                const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
                for (let k = 0; k < n; k++) {
                    const t = k / n, t2 = t * t, t3 = t2 * t, f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
                    out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2])]);
                }
            }
            out.push(pts[pts.length - 1]);
            return out;
        };
        const dot = (g, x, y, r, fill) => { g.fillStyle = fill; g.beginPath(); g.arc(X(x), Y(y), Math.max(0.5, r * S), 0, 7); g.fill(); };
        const hv = L => { const v = Math.min(255, 70 + L * 30); return `rgb(${v},${v},${v})`; };
        // 一個「浮雕塊」：先投影、再白色本體、再亮面，高度圖按層次堆高
        const part = (samples, L) => {
            for (const [x, y, r] of samples) dot(gc, x + 6, y + 9, r, 'rgba(60,64,70,0.38)');
            for (const [x, y, r] of samples) dot(gc, x, y, r, '#e3e4e3');
            for (const [x, y, r] of samples) dot(gc, x - r * 0.14, y - r * 0.2, r * 0.8, '#f8f8f7');
            for (const [x, y, r] of samples) dot(gh, x, y, r, hv(L));
        };
        const ribbon = (pts, L) => part(spline(pts), L);
        const ellipse = (cx, cy, rx, ry, L, rot = 0) => {
            const draw = (g, ox, oy, sx, fill) => { g.fillStyle = fill; g.beginPath(); g.ellipse(X(cx) + ox, Y(cy) + oy, rx * S * sx, ry * S * sx, rot, 0, 7); g.fill(); };
            draw(gc, 6, 9, 1, 'rgba(60,64,70,0.38)'); draw(gc, 0, 0, 1, '#e3e4e3'); draw(gc, -rx * 0.05, -ry * 0.1, 0.86, '#f8f8f7');
            draw(gh, 0, 0, 1, hv(L));
        };
        const spike = (bx, by, tx, ty, w, L) => {
            const nx = -(ty - by), ny = tx - bx, l = Math.hypot(nx, ny) || 1, ox = nx / l * w, oy = ny / l * w;
            for (const [g, sh] of [[gc, 'rgba(60,64,70,0.38)'], [gc, '#eeeeec'], [gh, hv(L)]]) {
                const d = g === gc && sh.startsWith('rgba') ? [6, 9] : [0, 0];
                g.fillStyle = sh; g.beginPath();
                g.moveTo(X(bx + ox) + d[0], Y(by + oy) + d[1]); g.lineTo(X(tx) + d[0], Y(ty) + d[1]); g.lineTo(X(bx - ox) + d[0], Y(by - oy) + d[1]); g.closePath(); g.fill();
            }
        };
        const scroll = (cx, cy, r0, turns, w, L, dir = 1, a0 = 0) => {
            const pts = [];
            for (let t = 0; t <= turns * 6.283; t += 0.4) { const k = 1 - t / (turns * 6.283) * 0.78; pts.push([cx + Math.cos(a0 + t * dir) * r0 * k, cy + Math.sin(a0 + t * dir) * r0 * k, w * (0.55 + 0.45 * k)]); }
            ribbon(pts, L);
        };
        const engrave = (pts, w = 4) => {   // 刻線：暗線＋亮邊
            const sp = spline(pts.map(p => [p[0], p[1], 0]), 4);
            for (const [dx, dy, col2, lw] of [[2, 3, 'rgba(255,255,255,0.75)', w * S * 0.8], [0, 0, 'rgba(105,110,118,0.62)', w * S]]) {
                gc.strokeStyle = col2; gc.lineWidth = lw; gc.lineCap = 'round'; gc.beginPath();
                sp.forEach(([x, y], i) => i ? gc.lineTo(X(x) + dx, Y(y) + dy) : gc.moveTo(X(x) + dx, Y(y) + dy)); gc.stroke();
            }
        };

        // ── 由後往前（L 越大越高）──
        ellipse(375, 895, 195, 150, 1);                                                             // 下方大圓身軀
        ribbon([[60, 700, 6], [110, 760, 22], [90, 820, 22], [150, 850, 14]], 2);                    // 左側火焰尾
        ribbon([[170, 760, 10], [130, 790, 18], [105, 830, 14]], 2);
        ribbon([[135, 940, 14], [150, 1000, 22], [210, 1030, 18], [240, 1000, 10]], 2);              // 左下雲
        ribbon([[320, 1085, 24], [400, 1092, 28], [470, 1088, 26], [545, 1075, 22]], 2);              // 底部雲座
        ribbon([[725, 835, 28], [650, 785, 34], [530, 775, 36], [410, 790, 32], [335, 860, 30], [315, 950, 30], [385, 1010, 28], [480, 1000, 26], [535, 940, 24], [490, 905, 20]], 3);   // 尾部 S 帶
        ribbon([[760, 640, 10], [770, 720, 26], [740, 800, 28], [690, 860, 22], [640, 900, 16]], 2);   // 右側身軀外緣
        scroll(655, 795, 42, 1.4, 22, 4, 1); scroll(455, 955, 40, 1.4, 20, 4, -1); scroll(205, 1015, 24, 1.3, 14, 4, 1); scroll(190, 745, 30, 1.3, 14, 4, 1);
        // 上半：背脊與火焰鬃毛
        ribbon([[180, 165, 5], [260, 125, 16], [360, 95, 24], [455, 78, 18], [500, 100, 10]], 2);      // 頂端火焰鬃（三片）
        ribbon([[205, 235, 5], [300, 190, 14], [390, 165, 20], [450, 190, 12]], 3);
        ribbon([[310, 70, 5], [390, 52, 12], [480, 72, 14]], 2);
        ribbon([[560, 235, 8], [548, 160, 26], [578, 95, 24], [622, 72, 10]], 3);                     // 右上圓耳
        ribbon([[505, 215, 36], [405, 225, 42], [305, 270, 46], [252, 350, 48], [272, 432, 50], [352, 482, 48], [480, 508, 44], [600, 512, 40], [705, 500, 28]], 4);   // 主背脊
        ribbon([[480, 337, 26], [560, 303, 30], [645, 312, 28], [655, 348, 22], [600, 368, 22], [520, 358, 20]], 4);   // 右側雲渦
        scroll(432, 335, 30, 1.3, 20, 5, 1); scroll(625, 337, 26, 1.3, 18, 5, -1);
        ribbon([[160, 345, 20], [195, 322, 24], [232, 352, 22], [212, 398, 22], [165, 392, 18]], 4);   // 左側小圈
        for (const [bx, by, tx, ty, w] of [[372, 462, 360, 428, 9], [425, 468, 424, 432, 10], [498, 478, 500, 440, 11], [548, 482, 560, 440, 11], [610, 488, 628, 436, 13], [660, 495, 690, 458, 12]]) spike(bx, by, tx, ty, w, 5);
        ribbon([[188, 518, 16], [235, 512, 22], [292, 497, 18]], 4);                                   // 爪
        for (const [x, y] of [[205, 522], [240, 520], [275, 506]]) dot(gc, x - 2, y - 1, 13, '#f4f4f3'), dot(gh, x, y, 13, hv(5));
        // 頭：魚形大頭，朝左
        ellipse(410, 640, 270, 98, 6, -0.07);
        ellipse(235, 640, 98, 92, 7, -0.05);
        spike(690, 560, 790, 575, 14, 7); spike(690, 520, 770, 488, 14, 7);                            // 右側兩根大尖刺
        scroll(215, 626, 30, 1.5, 12, 8, 1); dot(gc, 215, 626, 7, '#8c9095');                           // 螺旋眼
        engrave([[150, 665], [195, 690], [260, 676]], 5); engrave([[180, 585], [225, 570], [275, 585]], 4);   // 嘴、眉
        // 往右流動的鬃毛刻線
        for (let i = 0; i < 6; i++) {
            const y0 = 585 + i * 22;
            engrave([[300, y0 + 6], [420, y0 - 14], [540, y0 + 8 + i * 4], [650, y0 + 14 + i * 5]], 4);
        }
        // 鱗片刻線（背脊與下身）
        for (let i = 0; i < 7; i++) engrave([[400 + i * 32, 790], [420 + i * 32, 810], [440 + i * 32, 790]], 3);
        for (let i = 0; i < 5; i++) engrave([[260 + i * 30, 880 + (i % 2) * 14], [280 + i * 30, 902 + (i % 2) * 14], [300 + i * 30, 880 + (i % 2) * 14]], 3);

        // 高度圖模糊 → bumpMap
        const bc = mk(), bg = bc.getContext('2d');
        bg.filter = 'blur(7px)'; bg.drawImage(hgt, 0, 0); bg.filter = 'none';
        const t = new THREE.CanvasTexture(col); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
        this._dragonBump = new THREE.CanvasTexture(bc); this._dragonBump.anisotropy = 8;
        this._dragonTex = t;
        return t;
    }

    // 外法線：往牆外推一點點，看落在多邊形裡還是外面（麗澤樓是凹字形，不能用重心判斷）
    lizeOutward(footprint, i) {
        const n = footprint.length, a = footprint[i], b = footprint[(i + 1) % n];
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        let nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
        const px = (a.x + b.x) / 2 + nx * 0.3, pz = (a.z + b.z) / 2 + nz * 0.3;
        let inside = false;
        for (let k = 0, j = n - 1; k < n; j = k++) {
            const p = footprint[k], q = footprint[j];
            if ((p.z > pz) !== (q.z > pz) && px < (q.x - p.x) * (pz - p.z) / (q.z - p.z) + p.x) inside = !inside;
        }
        if (inside) { nx = -nx; nz = -nz; }
        return { nx, nz, len };
    }

    // 麗澤樓每面牆是「正面（朝中庭）／背面／山牆與轉折」
    classifyLizeEdges(footprint) {
        const cx = footprint.reduce((a, p) => a + p.x, 0) / footprint.length;
        const dx = cx > 0 ? -1 : 1;   // 朝向中庭（x=0）的方向
        return footprint.map((a, i) => {
            const { nx, len } = this.lizeOutward(footprint, i);
            if (len < 0.01) return 'end';
            const dot = nx * dx;
            return dot > 0.5 ? 'front' : dot < -0.5 ? 'back' : 'end';
        });
    }

    // 麗澤樓（照片）：中庭側正面入口（圓弧花崗岩門廊＋半圓台階＋坡道＋水池）、南端山牆的「飛龍乘雲」、北端接操場的小門與鋪面
    addLizeDetails(footprint, height, floors) {
        const cx = footprint.reduce((a, p) => a + p.x, 0) / footprint.length;
        const cz = footprint.reduce((a, p) => a + p.z, 0) / footprint.length;
        const fh = height / floors;
        const granite = new THREE.MeshStandardMaterial({ color: 0xa8928a, roughness: 0.8 });
        const graniteL = new THREE.MeshStandardMaterial({ color: 0xb9a49c, roughness: 0.75 });
        const dark = new THREE.MeshStandardMaterial({ color: 0x1f2428, roughness: 0.3, metalness: 0.2 });
        const stone = new THREE.MeshStandardMaterial({ color: 0x9a918b, roughness: 0.95 });

        // (1) 正面入口（面向中庭；長邊約 42% 處）：圓弧凸出的粉灰花崗岩門廊、兩根粗圓柱、半圓形台階、右側無障礙坡道、左側水池
        const front = this.getFacingEdge(footprint, 0, cz);
        if (front) {
            const { g, add } = this.edgeFrame(front, 0.42);
            const R = 4.6, P = 0.48;                       // 門廊半徑、台階頂高
            const dbl = (c, r = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: r, side: THREE.DoubleSide });
            const greyPanel = dbl(0xc9c6bf, 0.85), maroon = dbl(0x8e4545, 0.7);
            const metal = new THREE.MeshStandardMaterial({ color: 0xb8bdc2, roughness: 0.35, metalness: 0.8 });
            // 朝外（+z）的半圓柱 / 半圓殼
            const halfCyl = (r, h, y, mat, open = false) => add(new THREE.CylinderGeometry(r, r, h, 40, 1, open, -Math.PI / 2, Math.PI), mat, 0, y, 0);

            // 半圓形台階（四級，越外越低）
            [6.8, 6.1, 5.4, 4.7].forEach((r, j) => { const m = halfCyl(r, P * (j + 1) / 4, P * (j + 1) / 8, dbl(0x9a918b, 0.95)); m.receiveShadow = true; });
            // 碰撞：半圓台階（每級 P/4）、右側無障礙坡道、兩根粗圓柱
            this.addWalkSurface(g, -6.8, 6.8, 0, 6.8, (x, z) => { const d = Math.hypot(x, z); return d <= 4.7 ? P : d <= 5.4 ? P * 0.75 : d <= 6.1 ? P * 0.5 : d <= 6.8 ? P * 0.25 : 0; });
            this.addWalkSurface(g, 4.7, 13.1, 1.1, 2.7, (x) => P * (13.1 - x) / 8.4);
            for (let k = 0; k < 4; k++) { const xa = 4.7 + k * 2.1, xb = xa + 2.1; this.addWalkBlocker(g, xa, xb, 2.7, 2.8, P * (13.1 - (xa + xb) / 2) / 8.4 + 0.95); }
            for (const sx of [-1, 1]) this.addWalkColumn(g, sx * 2.9, 1.5, 0.78);
            // 大門（暗色玻璃門）
            add(new THREE.BoxGeometry(5.6, 3.0, 0.2), dark, 0, P + 1.5, 0.15);
            // 兩根粗圓柱（粉灰花崗岩）＋柱基
            const H = fh - 0.45 - P;
            for (const sx of [-1, 1]) {
                add(new THREE.CylinderGeometry(0.72, 0.78, H, 24), graniteL, sx * 2.9, P + H / 2, 1.5);
                add(new THREE.CylinderGeometry(0.9, 0.9, 0.2, 24), granite, sx * 2.9, P + 0.1, 1.5);
            }
            // 圓弧雨庇（花崗岩）＋上方圓弧陽台欄板（淺灰，帶酒紅飾條）
            halfCyl(R, 0.9, fh - 0.45, granite);
            halfCyl(R - 0.12, 1.0, fh + 0.5, greyPanel, true);
            halfCyl(R - 0.06, 0.12, fh + 0.98, maroon, true);
            // 金色校名：沿圓弧排列，由右到左讀＝麗澤樓
            ['樓', '澤', '麗'].forEach((ch, i) => {
                const th = (i - 1) * 0.42;
                const c = this.charPlane([ch], 2, 2, '#e2c26a');
                c.scale.setScalar(0.42);
                c.position.set(R * Math.sin(th), fh - 0.45, R * Math.cos(th) + 0.03); c.rotation.y = th; g.add(c);
            });
            // 左端的直書落款「宋楚瑜」
            {
                const cv = document.createElement('canvas'); cv.width = 64; cv.height = 192;
                const cx2 = cv.getContext('2d'); cx2.fillStyle = '#e2c26a';
                cx2.font = "bold 56px 'Microsoft JhengHei', 'PMingLiU', serif"; cx2.textAlign = 'center'; cx2.textBaseline = 'middle';
                ['宋', '楚', '瑜'].forEach((ch, i) => cx2.fillText(ch, 32, 32 + i * 64));
                const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
                const sig = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.9), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
                const th = -0.92;
                sig.position.set(R * Math.sin(th), fh - 0.45, R * Math.cos(th) + 0.03); sig.rotation.y = th; g.add(sig);
            }
            // 右側無障礙坡道（斜板＋金屬扶手）
            {
                const rl = 8.4, cx0 = 8.9, a = Math.atan2(P, rl);
                const ramp = add(new THREE.BoxGeometry(rl, 0.2, 1.6), stone, cx0, P / 2 - 0.1, 1.9); ramp.rotation.z = -a; ramp.receiveShadow = true;
                for (const rz of [2.75, 2.45]) { const rail = add(new THREE.BoxGeometry(rl, 0.04, 0.04), metal, cx0, P / 2 + (rz > 2.6 ? 0.95 : 0.5), rz, false); rail.rotation.z = -a; }
                for (let k = 0; k < 5; k++) {
                    const x = 4.9 + k * 2.1, hx = P * (cx0 + rl / 2 - x) / rl;
                    add(new THREE.CylinderGeometry(0.03, 0.03, 0.95, 6), metal, x, hx + 0.475, 2.75, false);
                }
            }
            // 左側中庭水池（混凝土池緣＋墨綠池水）；位置不夠就不放
            {
                const phi = Math.atan2(front.nx, front.nz);
                const elen = Math.hypot(front.end.x - front.start.x, front.end.z - front.start.z);
                const sgn = ((front.end.x - front.start.x) * Math.cos(phi) - (front.end.z - front.start.z) * Math.sin(phi)) > 0 ? 1 : -1;
                const pw = Math.min(11.5, (sgn > 0 ? 0.42 : 0.58) * elen - 9), pd = 5;
                if (pw >= 5) {
                    const px = -(8.2 + pw / 2), pz = 5.5;
                    const rimM = new THREE.MeshStandardMaterial({ color: 0xbab6aa, roughness: 0.9 });
                    const water = new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), new THREE.MeshStandardMaterial({ color: 0x55704a, roughness: 0.2, metalness: 0.15 }));
                    water.rotation.x = -Math.PI / 2; water.position.set(px, 0.14, pz); g.add(water);
                    add(new THREE.BoxGeometry(pw + 0.8, 0.4, 0.4), rimM, px, 0.2, pz - pd / 2 - 0.2);
                    add(new THREE.BoxGeometry(pw + 0.8, 0.4, 0.4), rimM, px, 0.2, pz + pd / 2 + 0.2);
                    add(new THREE.BoxGeometry(0.4, 0.4, pd), rimM, px - pw / 2 - 0.2, 0.2, pz);
                    add(new THREE.BoxGeometry(0.4, 0.4, pd), rimM, px + pw / 2 + 0.2, 0.2, pz);
                }
            }
            // ===== 前牆其他細部（依照片相機座標對位）=====
            {
                const phi = Math.atan2(front.nx, front.nz);
                const fz = front.start.z + (front.end.z - front.start.z) * 0.42;
                const fx = front.start.x + (front.end.x - front.start.x) * 0.42;
                const lx = zw => {   // 世界 z → 這面牆的區域 x
                    const t = (zw - front.start.z) / ((front.end.z - front.start.z) || 1);
                    const wx = front.start.x + (front.end.x - front.start.x) * t;
                    return (wx - fx) * Math.cos(phi) + (zw - fz) * (-Math.sin(phi));
                };
                const sN = Math.sign(-Math.sin(phi)) || 1;                  // 往北是區域 +x 還是 -x
                const zN = Math.max(...footprint.map(q => q.z));
                const conc = new THREE.MeshStandardMaterial({ color: 0xb7b3a9, roughness: 0.95 });
                const iron = new THREE.MeshStandardMaterial({ color: 0x4a4f52, roughness: 0.5, metalness: 0.6 });
                const white = new THREE.MeshStandardMaterial({ color: 0xece8de, roughness: 0.7 });
                const orange = new THREE.MeshStandardMaterial({ color: 0xd97b45, roughness: 0.85 });
                const meshM = new THREE.MeshStandardMaterial({ color: 0x2c3236, roughness: 0.5 });
                const glassM = new THREE.MeshStandardMaterial({ color: 0x6f8f92, roughness: 0.15, transparent: true, opacity: 0.65 });
                const greenRoof = new THREE.MeshStandardMaterial({ color: 0x3f7a62, roughness: 0.6, transparent: true, opacity: 0.9 });
                // 公布欄櫃（綠色玻璃雨庇）
                const vitrine = (xc, len) => {
                    this.addWalkBlocker(g, xc - len / 2, xc + len / 2, 0.1, 0.65, 1.5);
                    add(new THREE.BoxGeometry(len, 0.5, 0.5), conc, xc, 0.25, 0.4);
                    add(new THREE.BoxGeometry(len - 0.2, 0.8, 0.1), glassM, xc, 0.9, 0.4, false);
                    const r = add(new THREE.BoxGeometry(len, 0.08, 0.9), greenRoof, xc, 1.45, 0.5); r.rotation.x = 0.25;
                };
                // 鐵欄杆樓梯（6 階，往牆升高；一側混凝土矮牆、一側鐵欄杆）
                const stairs = (xc, vend) => {
                    for (let j = 0; j < 6; j++) add(new THREE.BoxGeometry(2.2, 0.17 * (j + 1), 0.3), conc, xc, 0.085 * (j + 1), 0.35 + (5 - j) * 0.3, false).receiveShadow = true;
                    for (let j = 0; j < 6; j++) { const zc = 0.35 + (5 - j) * 0.3; this.addWalkSurface(g, xc - 1.1, xc + 1.1, zc - 0.15, zc + 0.15, 0.17 * (j + 1)); }   // 6 階（往牆升高）
                    this.addWalkBlocker(g, xc + sN * 1.2 - 0.11, xc + sN * 1.2 + 0.11, 0, 2.0, 1.25);                                                    // 混凝土矮牆
                    for (let j = 0; j < 6; j++) { const zc = 0.35 + (5 - j) * 0.3, rxx = xc - sN * 1.2; this.addWalkBlocker(g, rxx - 0.06, rxx + 0.06, zc - 0.15, zc + 0.15, 0.17 * (j + 1) + 0.9); }   // 鐵欄杆
                    if (vend) this.addWalkBlocker(g, xc + sN * 2.4 - 0.45, xc + sN * 2.4 + 0.45, 0.25, 1.05, 1.9);                                        // 販賣機
                    add(new THREE.BoxGeometry(2.0, 2.5, 0.12), dark, xc, 1.02 + 1.25, 0.1);
                    add(new THREE.BoxGeometry(0.22, 1.25, 2.0), conc, xc + sN * 1.2, 0.62, 1.0);
                    const rx = xc - sN * 1.2;
                    const rail = add(new THREE.BoxGeometry(0.05, 0.05, 1.72), iron, rx, 1.5, 1.1, false); rail.rotation.x = 0.515;
                    for (const j of [0, 3, 5]) add(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), iron, rx, 0.17 * (j + 1) + 0.45, 0.35 + (5 - j) * 0.3, false);
                    if (vend) {
                        add(new THREE.BoxGeometry(0.9, 1.9, 0.8), new THREE.MeshStandardMaterial({ color: 0xcfe3ee, roughness: 0.4 }), xc + sN * 2.4, 0.95, 0.65);
                        add(new THREE.BoxGeometry(0.7, 1.2, 0.04), new THREE.MeshStandardMaterial({ color: 0x35506b, roughness: 0.3 }), xc + sN * 2.4, 1.1, 1.07, false);
                    }
                };
                // (a) 北段（籃球場、藍色跑道那一側）：白色小門＋公布欄櫃、冷氣室外機、鐵欄杆樓梯＋販賣機
                const xb = lx(zN - 10);
                add(new THREE.BoxGeometry(5.8, 2.9, 0.12), dark, xb, 1.45, 0.1);
                for (let i = 0; i < 6; i++) {
                    const x = xb + (i - 2.5) * 0.92;
                    add(new THREE.BoxGeometry(0.8, 2.4, 0.06), white, x, 1.2, 0.2);
                    add(new THREE.BoxGeometry(0.5, 0.55, 0.03), meshM, x, 1.85, 0.25, false);
                }
                for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.5, 3.1, 0.6), orange, xb + sx * 3.1, 1.55, 0.3);
                add(new THREE.BoxGeometry(6.7, 0.5, 0.7), orange, xb, 3.3, 0.35);
                vitrine(xb, 5.4);
                const acM = new THREE.MeshStandardMaterial({ color: 0xcfd2d4, roughness: 0.6 });
                const xa = lx(zN - 6.2);
                for (let k = 0; k < 4; k++) {
                    const x = xa + (k % 2 - 0.5) * 0.95, y = 0.4 + Math.floor(k / 2) * 0.85;
                    add(new THREE.BoxGeometry(0.9, 0.75, 0.4), acM, x, y, 0.45);
                    add(new THREE.BoxGeometry(0.56, 0.5, 0.04), meshM, x, y, 0.67, false);
                }
                stairs(lx(zN - 3.4), true);
                // (b) 正門南側：花崗岩拱窗下的公布欄櫃（在斜坡後面）
                vitrine(8.6, 7.2);
                // (c) 南段第二入口：突出的粉灰花崗岩牆（直書「麗澤樓」）＋綠色牆板＋台階＋混凝土矮牆
                const xw = lx(-38.2);
                add(new THREE.BoxGeometry(3.0, fh, 1.0), granite, xw, fh / 2, 0.5);
                this.addWalkBlocker(g, xw - 1.5, xw + 1.5, 0, 1.0, fh);
                {
                    const cv = document.createElement('canvas'); cv.width = 80; cv.height = 240;
                    const c2 = cv.getContext('2d'); c2.fillStyle = '#3a2c28';
                    c2.font = "bold 66px 'Microsoft JhengHei', 'PMingLiU', serif"; c2.textAlign = 'center'; c2.textBaseline = 'middle';
                    ['麗', '澤', '樓'].forEach((ch, i) => c2.fillText(ch, 40, 40 + i * 80));
                    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
                    const vt = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 1.65), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
                    vt.position.set(xw, 2.9, 1.02); g.add(vt);
                }
                add(new THREE.BoxGeometry(2.0, 1.2, 0.05), new THREE.MeshStandardMaterial({ color: 0x1f8a4a, roughness: 0.6 }), lx(-41.4), 0.9, 0.06, false);
                stairs(lx(-43.2), false);
                add(new THREE.BoxGeometry(1.8, 1.2, 0.3), conc, lx(-45.9), 0.6, 0.4);
                this.addWalkBlocker(g, lx(-45.9) - 0.9, lx(-45.9) + 0.9, 0.25, 0.55, 1.2);
            }
            this.scene.add(g);
        }

        // (2) 南端山牆（面向校門）：灰色牆板＋白色飛龍
        const south = this.getFacingEdge(footprint, cx, cz - 100);
        if (south) {
            const { g } = this.edgeFrame(south, 0.5);
            const sl = Math.hypot(south.end.x - south.start.x, south.end.z - south.start.z);
            const w = Math.min(6.6, sl * 0.55), h = w * 2;
            // 照片：灰色大牆板從頂樓一路到二樓，龍浮雕在上半部
            const bw = Math.min(7.4, sl * 0.62), bh = height * 0.8;
            const backing = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshStandardMaterial({ color: 0xcfcdc6, roughness: 0.95 }));
            backing.position.set(0, height - 1.0 - bh / 2, 0.05);
            g.add(backing);
            const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: this.makeDragonTexture(), bumpMap: this._dragonBump, bumpScale: 2.4, roughness: 0.92 }));
            panel.position.set(0, height - 2.6 - h / 2, 0.1);
            g.add(panel);
            this.scene.add(g);
            this.buildings.push({ mesh: g, name: '飛龍乘雲', interactive: true });
        }

        // (3) 北端（左端尾部）：接到操場。小門＋雨庇，外面鋪一塊水泥鋪面通到球場
        const north = this.getFacingEdge(footprint, cx, cz + 100);
        if (north) {
            const { g, add } = this.edgeFrame(north, 0.5);
            const nl = Math.hypot(north.end.x - north.start.x, north.end.z - north.start.z);
            add(new THREE.BoxGeometry(3.4, 2.9, 0.2), dark, 0, 1.45, 0.12);
            const apronL = 22;
            const apron = new THREE.Mesh(new THREE.PlaneGeometry(nl + 4, apronL), new THREE.MeshStandardMaterial({ color: 0xcfc9bc, roughness: 0.95 }));
            apron.rotation.x = -Math.PI / 2; apron.position.set(0, 0.07, apronL / 2 + 0.2); apron.receiveShadow = true;
            g.add(apron);
            this.scene.add(g);
        }
    }

    // 麗澤樓背面（照片，校門側、飛龍牆旁）：靠南端的長樓梯（平台往左彎回貼牆走道）＋鐵欄杆＋矮牆＋灌木
    addLizeBack(footprint) {
        const n = footprint.length;
        const cx = footprint.reduce((a, p) => a + p.x, 0) / n;
        const dx = cx > 0 ? -1 : 1;
        let best = null;
        for (let i = 0; i < n; i++) {
            const a = footprint[i], b = footprint[(i + 1) % n];
            const nm = this.lizeOutward(footprint, i);
            if (nm.len < 14 || nm.nx * dx > -0.5) continue;           // 只要背面的長牆
            const mz = (a.z + b.z) / 2;
            if (!best || mz < best.mz) best = { a, b, nm, mz };       // 取最南邊（z 最小）那一面
        }
        if (!best) return;
        const S = best.a.z < best.b.z ? best.a : best.b, T = best.a.z < best.b.z ? best.b : best.a;
        // 面向牆的人：右手邊＝區域 +x，左手邊＝區域 -x。彎回來的走道往「左」(-x)，
        // 所以從「-x 那一端」往另一端量 5.5 公尺放樓梯，留出彎回來的空間
        const sgn = Math.sign(-best.nm.nx) || 1;                      // +x 朝北 → -x 朝南 → 從南端量起
        const A = sgn > 0 ? S : T, B = sgn > 0 ? T : S;
        const k = 5.5 / best.nm.len;
        const pos = { x: A.x + (B.x - A.x) * k, z: A.z + (B.z - A.z) * k };
        const { g, add } = this.edgeFrame({ start: pos, end: pos, nx: best.nm.nx, nz: best.nm.nz }, 0);
        const conc = new THREE.MeshStandardMaterial({ color: 0xb7b3a9, roughness: 0.95 });
        const iron = new THREE.MeshStandardMaterial({ color: 0x4a4f52, roughness: 0.5, metalness: 0.6 });
        const dark = new THREE.MeshStandardMaterial({ color: 0x1f2428, roughness: 0.3, metalness: 0.2 });
        const leaf = [0x4f7f3a, 0x5d8c45, 0x3f6e33].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }));
        // 照片：以背面為正面。右邊那條垂直牆面的坡道（寬 2.2、長 L1）慢慢升上一樓平台，門在平台正中央（x=0，與上坡對齊）；
        // 到了平台之後換「左邊」這條接著下來：貼著麗澤樓外牆往左走（平行牆面）、寬度同樣 2.2、長度只有一半（L1/2），慢慢降回地面
        const W = 2.2, H = 1.1, L1 = 5.4, L2 = L1 / 2;
        // 實心楔形坡道（形狀 x＝沿坡方向、y＝高度）
        const wedge = (pts, x, z, rotY) => {
            const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
            const m = add(new THREE.ExtrudeGeometry(sh, { depth: W, bevelEnabled: false }), conc, x, 0, z, false);
            m.rotation.y = rotY; m.receiveShadow = true; return m;
        };
        // 上坡（右）：離牆方向。擠出朝 -x，所以放在 x=+W/2
        wedge([[0, 0], [L1, 0], [0, H]], W / 2, W, -Math.PI / 2);
        // 下坡（左）：貼牆往 -x 方向降，z 從 0 到 W（緊貼外牆），從平台左緣 x=-W/2 起算
        wedge([[0, 0], [-L2, 0], [0, H]], -W / 2, 0, 0);
        // 平台（高度 H，貼牆，只有一個坡道寬）
        add(new THREE.BoxGeometry(W, H, W), conc, 0, H / 2, W / 2);
        // 一樓的門：x＝0，與上去的坡道對齊
        add(new THREE.BoxGeometry(2.0, 2.5, 0.12), dark, 0, H + 1.25, 0.1);
        // 欄杆：上坡兩側（沿 z 斜）、下坡外緣（沿 x 斜，在 z=W）、平台右端與下坡盡頭
        const railZ = (L, x) => { const r = add(new THREE.BoxGeometry(0.05, 0.05, Math.hypot(L, H)), iron, x, H / 2 + 0.9, W + L / 2, false); r.rotation.x = Math.atan2(H, L); };
        railZ(L1, W / 2 - 0.05); railZ(L1, -W / 2 + 0.05);
        const rx = add(new THREE.BoxGeometry(Math.hypot(L2, H), 0.05, 0.05), iron, -W / 2 - L2 / 2, H / 2 + 0.9, W - 0.05, false);
        rx.rotation.z = Math.atan2(H, L2);
        add(new THREE.BoxGeometry(0.05, 0.05, W), iron, W / 2 - 0.05, H + 0.9, W / 2, false);   // 平台右端
        for (const [x, z, y] of [[W / 2 - 0.05, W + L1, 0], [-W / 2 + 0.05, W + L1, 0], [W / 2 - 0.05, W, H], [-W / 2 + 0.05, W, H],
                                 [-W / 2 - L2, W - 0.05, 0], [W / 2 - 0.05, 0.05, H]])
            add(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), iron, x, y + 0.45, z, false);
        // ── 碰撞：坡道／平台可走上去，欄杆擋人 ──
        this.addWalkSurface(g, -W / 2, W / 2, W, W + L1, (x, z) => H * (1 - (z - W) / L1));      // 上坡（右）
        this.addWalkSurface(g, -W / 2, W / 2, 0, W, H);                                          // 平台（門前）
        this.addWalkSurface(g, -W / 2 - L2, -W / 2, 0, W, (x) => H * (1 - (-W / 2 - x) / L2));   // 下坡（左，貼牆）
        const N = 6, tk = 0.06;
        for (let i = 0; i < N; i++) {
            const za = W + L1 * i / N, zb = W + L1 * (i + 1) / N, top = H * (1 - ((za + zb) / 2 - W) / L1) + 0.9;
            this.addWalkBlocker(g, W / 2 - 0.05 - tk, W / 2 - 0.05 + tk, za, zb, top);             // 上坡右欄杆
            this.addWalkBlocker(g, -W / 2 + 0.05 - tk, -W / 2 + 0.05 + tk, za, zb, top);           // 上坡左欄杆
            const xa = -W / 2 - L2 * i / N, xb = -W / 2 - L2 * (i + 1) / N, topD = H * (1 - (-W / 2 - (xa + xb) / 2) / L2) + 0.9;
            this.addWalkBlocker(g, Math.min(xa, xb), Math.max(xa, xb), W - 0.05 - tk, W - 0.05 + tk, topD);   // 下坡外緣欄杆
        }
        this.addWalkBlocker(g, W / 2 - 0.05 - tk, W / 2 - 0.05 + tk, 0, W, H + 0.9);             // 平台右端欄杆
        // 右側（樓梯另一邊）：長長的混凝土矮牆（平行外牆，離牆約 5.5 公尺），牆與矮牆之間種灌木
        const cl = Math.min(14, best.nm.len - 5.5 - 3 - 2);
        if (cl > 3) {
            add(new THREE.BoxGeometry(cl, 0.4, 0.25), conc, 3 + cl / 2, 0.2, 5.5);
            this.addWalkBlocker(g, 3, 3 + cl, 5.5 - 0.125, 5.5 + 0.125, 0.4);
            for (let i = 0; i < 11; i++) {
                const m = add(new THREE.SphereGeometry(0.75, 8, 6), leaf[i % 3], 2.6 + i * 1.2, 0.6, 1.4 + (i % 3) * 1.3, false);
                m.scale.set(1.2, 0.9, 1.0);
            }
        }
        this.scene.add(g);
    }

    // 體育運動館（照片）：屋頂有一條磚紅色欄牆，上面是由右到左的「體育運動館」米色字
    addPEDetails(footprint, height) {
        const front = this.getFrontEdge(footprint);
        if (!front) return;
        const style = this.getBuildingStyle('體育運動館');
        const len = Math.hypot(front.end.x - front.start.x, front.end.z - front.start.z);
        const mx = (front.start.x + front.end.x) / 2, mz = (front.start.z + front.end.z) / 2;
        const rot = Math.atan2(-(front.end.z - front.start.z), front.end.x - front.start.x);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 1.8, 0.5), new THREE.MeshStandardMaterial({ color: style.wall, roughness: 0.85 }));
        strip.position.set(mx, height + 0.9, mz); strip.rotation.y = rot; strip.castShadow = true; this.scene.add(strip);
        const rim = new THREE.Mesh(new THREE.BoxGeometry(len + 0.1, 0.25, 0.7), new THREE.MeshStandardMaterial({ color: style.band, roughness: 0.8 }));
        rim.position.set(mx, height + 1.9, mz); rim.rotation.y = rot; this.scene.add(rim);
        const nm = this.charPlane(['館', '動', '運', '育', '體'], Math.min(len * 0.8, 40), 1.3, '#f3e9d8');
        nm.position.set(mx + front.nx * 0.28, height + 0.95, mz + front.nz * 0.28);
        nm.rotation.y = Math.atan2(front.nx, front.nz);
        this.scene.add(nm);
    }

    // 科學館（照片）：二樓褐色磨石牆面＋突出的褐色橫樑（金色「科學館」），底下是暗色玻璃大門與寬階梯
    addScienceEntrance(footprint, height) {
        const cz = footprint.reduce((a, p) => a + p.z, 0) / footprint.length;
        const front = this.getFacingEdge(footprint, 0, cz);
        if (!front) return;
        const { g, add } = this.edgeFrame(front, 0.5);
        const fh = height / 4;
        const brown = new THREE.MeshStandardMaterial({ color: 0x6f4a49, roughness: 0.4, metalness: 0.15 });
        const dark = new THREE.MeshStandardMaterial({ color: 0x1b2124, roughness: 0.25, metalness: 0.3 });
        const light = new THREE.MeshStandardMaterial({ color: 0xd9d5ca, roughness: 0.6 });
        const metal = new THREE.MeshStandardMaterial({ color: 0xbfc4c8, roughness: 0.35, metalness: 0.8 });
        const stone = new THREE.MeshStandardMaterial({ color: 0xaaa69c, roughness: 0.95 });
        add(new THREE.BoxGeometry(14, 1.4, 1.8), brown, 0, fh + 0.2, 0.9);
        add(new THREE.BoxGeometry(12, 3.4, 0.5), brown, 0, fh + 2.6, 0.25);
        const nm = this.charPlane(['館', '學', '科'], 6.4, 0.9, '#e3c57d');       // 由右到左：科學館
        nm.position.set(0, fh + 0.2, 1.82); g.add(nm);
        add(new THREE.BoxGeometry(9.5, 3.2, 0.3), dark, 0, 1.6, 0.2);
        for (let i = -3; i <= 3; i++) add(new THREE.BoxGeometry(0.07, 3.0, 0.12), metal, i * 1.4, 1.6, 0.4, false);
        for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(0.18, 0.2, fh, 12), light, sx * 5.8, fh / 2, 1.6);
        for (let j = 0; j < 4; j++) {
            add(new THREE.BoxGeometry(14, 0.15 * (4 - j), 0.6), stone, 0, 0.075 * (4 - j), 2.3 + j * 0.6);
            this.addWalkSurface(g, -7, 7, 2.0 + j * 0.6, 2.6 + j * 0.6, 0.15 * (4 - j));
        }
        add(new THREE.BoxGeometry(14, 0.6, 1.5), stone, 0, 0.3, 1.25);          // 階梯頂端的平台（門前）
        this.addWalkSurface(g, -7, 7, 0.5, 2.0, 0.6);
        for (const sx of [-1, 1]) this.addWalkColumn(g, sx * 5.8, 1.6, 0.2);
        for (const sx of [-1, 1]) {
            add(new THREE.BoxGeometry(0.05, 0.05, 2.6), metal, sx * 2.4, 0.95, 3.5, false);
            for (const z of [2.4, 4.6]) add(new THREE.CylinderGeometry(0.03, 0.03, 0.95, 6), metal, sx * 2.4, 0.5, z, false);
            this.addWalkBlocker(g, sx * 2.4 - 0.05, sx * 2.4 + 0.05, 2.4, 4.6, 1.0);
        }
        this.scene.add(g);
    }

    addShensiSunshades(footprint, height, floors) {
        const material = new THREE.MeshStandardMaterial({ color: 0xa7a69e, roughness: 0.78 });
        for (let edge = 0; edge < footprint.length; edge++) {
            const start = footprint[edge], end = footprint[(edge + 1) % footprint.length];
            const dx = end.x - start.x, dz = end.z - start.z;
            const length = Math.hypot(dx, dz);
            if (length < 8) continue;
            const midpointX = (start.x + end.x) / 2, midpointZ = (start.z + end.z) / 2;
            const band = new THREE.Mesh(new THREE.BoxGeometry(length + 0.4, 0.28, 1.15), material);
            band.position.set(midpointX, height * 0.5, midpointZ);
            band.rotation.y = Math.atan2(-dz, dx);
            band.castShadow = true;
            this.scene.add(band);
            for (let floor = 1; floor < floors; floor++) {
                const shade = band.clone();
                shade.position.y = height * floor / floors;
                this.scene.add(shade);
            }
        }
    }

    addJingxianFins(footprint, height) {
        const material = new THREE.MeshStandardMaterial({ color: 0xe3e0d7, roughness: 0.72 });
        for (let edge = 0; edge < footprint.length; edge++) {
            const start = footprint[edge], end = footprint[(edge + 1) % footprint.length];
            const dx = end.x - start.x, dz = end.z - start.z;
            const length = Math.hypot(dx, dz);
            const count = Math.floor(length / 3.4);
            if (count < 2) continue;
            const rotation = Math.atan2(-dz, dx);
            for (let index = 0; index <= count; index++) {
                const ratio = index / count;
                const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, height, 0.3), material);
                fin.position.set(start.x + dx * ratio, height / 2, start.z + dz * ratio);
                fin.rotation.y = rotation;
                this.scene.add(fin);
            }
        }
    }

    getFrontEdge(footprint) {
        let front = null;
        for (let index = 0; index < footprint.length; index++) {
            const start = footprint[index], end = footprint[(index + 1) % footprint.length];
            const dx = end.x - start.x, dz = end.z - start.z;
            const length = Math.hypot(dx, dz);
            if (length < 1) continue;
            const midpointX = (start.x + end.x) / 2, midpointZ = (start.z + end.z) / 2;
            let nx = -dz / length, nz = dx / length;
            const centerX = footprint.reduce((sum, point) => sum + point.x, 0) / footprint.length;
            const centerZ = footprint.reduce((sum, point) => sum + point.z, 0) / footprint.length;
            if (nx * (centerX - midpointX) + nz * (centerZ - midpointZ) > 0) { nx *= -1; nz *= -1; }
            const score = -nz * Math.min(1, length / 10) + length * 0.001;
            if (!front || score > front.score) front = { start, end, nx, nz, score };
        }
        return front;
    }

    addBuildingNameplate(name, footprint, height) {
        const front = this.getFrontEdge(footprint);
        if (!front) return;
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const context = canvas.getContext('2d');
        context.fillStyle = '#762f32';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#f4eee3';
        context.font = 'bold 64px Microsoft JhengHei, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(name, canvas.width / 2, canvas.height / 2);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const signWidth = Math.max(5, Math.min(10, name.length * 1.15));
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(signWidth, 1.25), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
        sign.position.set((front.start.x + front.end.x) / 2 + front.nx * 0.24, Math.max(2, height - 1.4), (front.start.z + front.end.z) / 2 + front.nz * 0.24);
        sign.rotation.y = Math.atan2(front.nx, front.nz);
        this.scene.add(sign);
    }

    createMappedCampus() {
        const boundary = [
            [120.6852072, 24.1496057], [120.6861879, 24.1492715],
            [120.6870397, 24.1490114], [120.6873403, 24.1496803],
            [120.6879045, 24.1509335], [120.6880403, 24.1512680],
            [120.6866149, 24.1517145], [120.6866637, 24.1518477],
            [120.6861959, 24.1520302], [120.6857777, 24.1509606]
        ];
        this.campusBoundary = boundary.map(([lon, lat]) => this.projectMapPoint(lon, lat));

        const outside = new THREE.Mesh(
            new THREE.PlaneGeometry(480, 480),
            new THREE.MeshStandardMaterial({ color: 0x5d6266, roughness: 0.95 })
        );
        outside.rotation.x = -Math.PI / 2;
        outside.position.y = -0.03;
        outside.receiveShadow = true;
        this.scene.add(outside);
        this.createMapShape(boundary, new THREE.MeshStandardMaterial({ color: 0x8fb36a, roughness: 0.96 }), 0);

        const buildings = [
            ['康樂館', 15, 3, 0xb9b4a6, [[120.6869421,24.1497498],[120.6872844,24.1496332],[120.6872607,24.1495751],[120.6870914,24.1491612],[120.6870589,24.1490817],[120.6867248,24.1491954],[120.6867580,24.1492765],[120.6867833,24.1492679],[120.6869387,24.1496482],[120.6869052,24.1496596]]],
            ['科學館', 16, 4, 0xb8b5aa, [[120.6854000,24.1500053],[120.6854468,24.1499889],[120.6853534,24.1497672],[120.6853274,24.1497763],[120.6852933,24.1496954],[120.6855405,24.1496086],[120.6857133,24.1500183],[120.6854452,24.1501125]]],
            ['莊敬樓', 17, 4, 0xc1b9a8, [[120.6868250,24.1497253],[120.6867466,24.1495486],[120.6859686,24.1498356],[120.6860490,24.1500170],[120.6862117,24.1499570],[120.6861811,24.1498880],[120.6866254,24.1497240],[120.6866539,24.1497885]]],
            ['敬業樓', 18, 5, 0xb8b6ad, [[120.6862153,24.1504889],[120.6860419,24.1500291],[120.6861682,24.1499895],[120.6861875,24.1500405],[120.6862347,24.1500257],[120.6862814,24.1501494],[120.6862258,24.1501669],[120.6862525,24.1502378],[120.6863064,24.1502209],[120.6863486,24.1503329],[120.6862938,24.1503501],[120.6863323,24.1504522]]],
            ['校史館', 6.5, 1, 0xbcae94, [[120.6856318,24.1503326],[120.6855679,24.1501746],[120.6858499,24.1500797],[120.6859137,24.1502376]]],
            ['慎思樓', 23, 7, 0xb8b8b3, [[120.6863444,24.1507282],[120.6863238,24.1506856],[120.6862827,24.1506941],[120.6862490,24.1506156],[120.6862883,24.1505934],[120.6862827,24.1505729],[120.6863856,24.1505354],[120.6864099,24.1505849],[120.6868981,24.1504261],[120.6868700,24.1503254],[120.6869186,24.1503135],[120.6869261,24.1503340],[120.6869486,24.1503271],[120.6869635,24.1503664],[120.6869879,24.1503579],[120.6870066,24.1504125],[120.6870084,24.1504466],[120.6869486,24.1504705],[120.6869729,24.1505285],[120.6864417,24.1507095],[120.6864304,24.1506941]]],
            ['麗澤樓', 24, 7, 0xb5b3ad, [[120.6874026,24.1504158],[120.6873686,24.1503202],[120.6872722,24.1503488],[120.6872216,24.1502068],[120.6872849,24.1501881],[120.6872407,24.1500637],[120.6871738,24.1500835],[120.6870917,24.1498529],[120.6869763,24.1498871],[120.6871872,24.1504797]]],
            ['景賢樓', 20, 6, 0xb5b3ad, [[120.6860795,24.1506751],[120.6860365,24.1505658],[120.6858562,24.1506248],[120.6858410,24.1505863],[120.6858770,24.1505745],[120.6858413,24.1504837],[120.6859926,24.1504342],[120.6859481,24.1503211],[120.6857677,24.1503802],[120.6856639,24.1504142],[120.6857803,24.1507104],[120.6858619,24.1506837],[120.6858837,24.1507392]]],
            ['第一學生宿舍', 17, 5, 0xb4b4ad, [[120.6862194,24.1512068],[120.6860829,24.1508603],[120.6862406,24.1508086],[120.6863770,24.1511551]]],
            ['第二學生宿舍', 17, 5, 0xb4b4ad, [[120.6862391,24.1513323],[120.6862005,24.1512281],[120.6864204,24.1511604],[120.6865667,24.1515561],[120.6864874,24.1515806],[120.6864767,24.1515515],[120.6864436,24.1515617],[120.6864243,24.1515098],[120.6863924,24.1515196],[120.6863145,24.1513091]]],
            ['體育運動館', 20, 5, 0xb0b4b0, [[120.6867016,24.1516927],[120.6866503,24.1515741],[120.6872137,24.1513712],[120.6872650,24.1514898]]],
            ['音樂館', 11, 3, 0xbab6ac, [[120.6872872,24.1514955],[120.6872344,24.1513664],[120.6877270,24.1511985],[120.6877798,24.1513276]]]
        ];
        for (const [name, height, floors, color, points] of buildings) {
            this.createMappedBuilding(name, points, height, floors, color);
        }

        const pitchMaterial = new THREE.MeshStandardMaterial({ color: 0xc8694a, roughness: 0.9 });
        const pitches = [
            [[120.6859843,24.1514507],[120.6861613,24.1513892],[120.6860171,24.1510440],[120.6858402,24.1511055]],
            [[120.6872796,24.1508293],[120.6875483,24.1507421],[120.6875020,24.1506232],[120.6872333,24.1507103]],
            [[120.6870482,24.1510876],[120.6873169,24.1510004],[120.6872706,24.1508815],[120.6870019,24.1509686]],
            [[120.6872538,24.1511867],[120.6872972,24.1512928],[120.6870173,24.1513881],[120.6869739,24.1512819]],
            [[120.6869863,24.1509236],[120.6872550,24.1508364],[120.6872087,24.1507175],[120.6869400,24.1508046]],
            [[120.6868956,24.1512993],[120.6869464,24.1514235],[120.6866740,24.1515163],[120.6866232,24.1513921]],
            [[120.6876103,24.1510709],[120.6876573,24.1512003],[120.6873483,24.1512946],[120.6873013,24.1511740]],
            [[120.6873397,24.1509938],[120.6876084,24.1509066],[120.6875621,24.1507877],[120.6872934,24.1508748]]
        ];
        for (const pitch of pitches) this.createMapShape(pitch, pitchMaterial, 0.045);

        const gardenMaterial = new THREE.MeshStandardMaterial({ color: 0x5f9a56, roughness: 0.95 });
        this.createMapShape([[120.6856647,24.1496808],[120.6859493,24.1495869],[120.6859320,24.1495433],[120.6861745,24.1494633],[120.6861379,24.1493712],[120.6861050,24.1493821],[120.6860891,24.1493420],[120.6853516,24.1495854],[120.6853636,24.1496156],[120.6856070,24.1495353]], gardenMaterial, 0.04);
        this.createMapShape([[120.6864096,24.1493450],[120.6864541,24.1493548],[120.6867257,24.1492638],[120.6866716,24.1491256],[120.6863687,24.1492287]], gardenMaterial, 0.04);
        this.createMapShape([[120.6861725,24.1519310],[120.6863629,24.1518698],[120.6861832,24.1514537],[120.6860035,24.1515174]], new THREE.MeshStandardMaterial({ color: 0x416e83, roughness: 0.3 }), 0.08);

        const pathMaterial = new THREE.MeshStandardMaterial({ color: 0xe4d9bf, roughness: 0.9, side: THREE.DoubleSide });
        this.createMapPath([[120.6861879,24.1492715],[120.6862497,24.1494038],[120.6863192,24.1494364],[120.6864204,24.1494192],[120.6867502,24.1493073],[120.6869524,24.1498078],[120.6870959,24.1497661],[120.6873403,24.1496803]], 3, pathMaterial);
        this.createMapPath([[120.6862497,24.1494038],[120.6861969,24.1495261],[120.6857390,24.1496994],[120.6858585,24.1499736],[120.6859890,24.1502640],[120.6861857,24.1507318],[120.6859860,24.1508125],[120.6859155,24.1508955],[120.6857777,24.1509606],[120.6857428,24.1509797]], 3, pathMaterial);
    }

    
    textPlane(text, w, h, bg, fg, fontPx = 96) {
        const c = document.createElement('canvas');
        c.width = 1024; c.height = Math.round(1024 * h / w);
        const x = c.getContext('2d');
        x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height);
        x.fillStyle = fg; x.font = `bold ${fontPx}px Microsoft JhengHei, sans-serif`;
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(text, c.width / 2, c.height / 2);
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
        return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t }));
    }

    // 其他校門：雙十南門（旁有塔、保留「國立」校名與省中校徽）、雙十北門（備用）、一中街側門；以及兩座碑與光中亭
    // 全部不做碰撞，只是看得到、走得過。
    // 校園圍牆（依街景照片）：紅磚方柱＋米色柱帽，柱與柱之間是矮磚牆加黑色鐵欄杆；
    // 牆外沿人行道擺一排紅磚花台，種灌木。大門、雙十南北門、一中街側門的位置留開口。
    getBrickTexture() {
        if (this._brickTex) return this._brickTex;
        const c = document.createElement('canvas'); c.width = 64; c.height = 128;
        const g = c.getContext('2d');
        g.fillStyle = '#c9bfae'; g.fillRect(0, 0, 64, 128);                    // 灰縫
        const rowH = 128 / 12, rand = this.seededRandom('brick');
        for (let r = 0; r < 12; r++) for (let k = 0; k < 2; k++) {
            const off = (r % 2) * 16, x = (k * 32 + off) % 64;
            const v = Math.floor(rand() * 26);
            g.fillStyle = `rgb(${150 + v},${72 + v * 0.5},${58 + v * 0.4})`;
            g.fillRect(x + 1, r * rowH + 1, 30, rowH - 2);
            if (x + 31 > 64) g.fillRect(0, r * rowH + 1, x + 31 - 64, rowH - 2);
        }
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
        this._brickTex = t;
        return t;
    }

    createCampusWalls() {
        const bd = this.campusBoundary;
        if (!bd) return;
        const brickMat = new THREE.MeshStandardMaterial({ map: this.getBrickTexture(), roughness: 0.92 });
        const capMat = new THREE.MeshStandardMaterial({ color: 0xd8cdb8, roughness: 0.85 });
        const ironMat = new THREE.MeshStandardMaterial({ color: 0x24272a, roughness: 0.5, metalness: 0.5 });
        const bushMat = new THREE.MeshStandardMaterial({ color: 0x3f7d3c, roughness: 0.95 });

        // 開口：[中心 x, 中心 z, 半徑]
        const gp = this.projectMapPoint(120.6862, 24.1493);
        const openings = [[gp.x - 2, gp.z, 28]];
        for (const [lon, lat, r] of [[120.687421, 24.14986, 11], [120.688013, 24.151201, 7.5], [120.685607, 24.150554, 5]]) {
            const p = this.projectMapPoint(lon, lat); openings.push([p.x, p.z, r]);
        }
        const open = (x, z) => openings.some(([ox, oz, r]) => Math.hypot(x - ox, z - oz) < r);

        const pillars = [], bases = [], bars = [], rails = [], planters = [];
        for (let i = 0; i < bd.length; i++) {
            const a = bd[i], b = bd[(i + 1) % bd.length];
            const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
            if (L < 2) continue;
            const ux = dx / L, uz = dz / L, ry = Math.atan2(-dz, dx);
            let nx = -uz, nz = ux;                                                        // 朝外法線
            if (this.isPointInPolygon((a.x + b.x) / 2 + nx * 0.5, (a.z + b.z) / 2 + nz * 0.5, bd)) { nx = -nx; nz = -nz; }
            const n = Math.max(1, Math.round(L / 3.3)), step = L / n;
            for (let j = 0; j <= n; j++) {
                const x = a.x + ux * step * j, z = a.z + uz * step * j;
                if (j < n || i === bd.length - 1) { if (!open(x, z)) pillars.push({ x, z, ry }); }
                if (j === n) continue;
                const mx = x + ux * step / 2, mz = z + uz * step / 2;
                if (open(mx, mz)) continue;
                const len = step - 0.55;
                bases.push({ x: mx, z: mz, len, ry });
                rails.push({ x: mx, z: mz, len, ry, y: 0.62 }, { x: mx, z: mz, len, ry, y: 1.4 });
                const nb = Math.floor(len / 0.14);
                for (let k = 0; k <= nb; k++) {
                    const off = -len / 2 + len * k / nb;
                    bars.push({ x: mx + ux * off, z: mz + uz * off, ry });
                }
                if (j % 2 === 0) planters.push({ x: mx + nx * 1.15, z: mz + nz * 1.15, ry });
            }
        }

        const o = new THREE.Object3D();
        const inst = (geo, mat, list, place, cast = true) => {
            if (!list.length) return;
            const m = new THREE.InstancedMesh(geo, mat, list.length);
            list.forEach((it, i) => { place(o, it); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
            m.castShadow = cast; m.receiveShadow = true; m.instanceMatrix.needsUpdate = true;
            this.scene.add(m);
        };
        const unit = new THREE.BoxGeometry(1, 1, 1);
        inst(new THREE.BoxGeometry(0.58, 1.8, 0.58), brickMat, pillars, (ob, p) => { ob.position.set(p.x, 0.9, p.z); ob.rotation.set(0, p.ry, 0); ob.scale.set(1, 1, 1); });
        inst(new THREE.BoxGeometry(0.76, 0.12, 0.76), capMat, pillars, (ob, p) => { ob.position.set(p.x, 1.86, p.z); ob.rotation.set(0, p.ry, 0); ob.scale.set(1, 1, 1); });
        inst(unit, brickMat, bases, (ob, p) => { ob.position.set(p.x, 0.25, p.z); ob.rotation.set(0, p.ry, 0); ob.scale.set(p.len, 0.5, 0.32); });
        inst(new THREE.BoxGeometry(0.03, 0.95, 0.03), ironMat, bars, (ob, p) => { ob.position.set(p.x, 0.98, p.z); ob.rotation.set(0, p.ry, 0); ob.scale.set(1, 1, 1); }, false);
        inst(unit, ironMat, rails, (ob, p) => { ob.position.set(p.x, p.y, p.z); ob.rotation.set(0, p.ry, 0); ob.scale.set(p.len, 0.05, 0.05); }, false);
        // 牆外磚砌花台＋灌木
        inst(unit, brickMat, planters, (ob, p) => { ob.position.set(p.x, 0.4, p.z); ob.rotation.set(0, p.ry, 0); ob.scale.set(2.3, 0.8, 0.85); });
        inst(unit, capMat, planters, (ob, p) => { ob.position.set(p.x, 0.83, p.z); ob.rotation.set(0, p.ry, 0); ob.scale.set(2.4, 0.07, 0.95); }, false);
        inst(new THREE.IcosahedronGeometry(0.55, 1), bushMat, planters, (ob, p) => { ob.position.set(p.x, 1.2, p.z); ob.rotation.set(0, p.ry, 0); ob.scale.set(1.9, 0.9, 0.85); });
    }

    createCampusGates() {
        const stone = new THREE.MeshStandardMaterial({ color: 0xcfc9bd, roughness: 0.9 });
        const cap = new THREE.MeshStandardMaterial({ color: 0x8a867c, roughness: 0.9 });
        const iron = new THREE.MeshStandardMaterial({ color: 0x2f3236, roughness: 0.5, metalness: 0.4 });
        const bd = this.campusBoundary;
        const makeGate = (name, lon, lat, half, sign, tower) => {
            const p = this.projectMapPoint(lon, lat);
            let best = null, bestD = Infinity;
            for (let i = 0; i < bd.length; i++) {
                const a = bd[i], b = bd[(i + 1) % bd.length];
                const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
                const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
                const q = { x: a.x + dx * t, z: a.z + dz * t };
                const d = Math.hypot(p.x - q.x, p.z - q.z);
                if (d < bestD) { bestD = d; best = { q, dx, dz }; }
            }
            const g = new THREE.Group();
            g.position.set(best.q.x, 0, best.q.z);
            g.rotation.y = Math.atan2(-best.dz, best.dx);
            const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
            for (const sx of [-1, 1]) {
                add(new THREE.BoxGeometry(1.2, 3.6, 1.2), stone, sx * (half + 0.6), 1.8, 0);
                add(new THREE.BoxGeometry(1.5, 0.3, 1.5), cap, sx * (half + 0.6), 3.75, 0);
            }
            add(new THREE.BoxGeometry(half * 2 + 2.4, 0.9, 0.7), new THREE.MeshStandardMaterial({ color: 0x762f32, roughness: 0.7 }), 0, 3.5, 0);
            for (const [z, ry] of [[0.36, 0], [-0.36, Math.PI]]) {
                const t = this.textPlane(sign, half * 2 + 1.8, 0.7, '#762f32', '#f4eee3', 88);
                t.position.set(0, 3.5, z); t.rotation.y = ry; g.add(t);
            }
            if (tower) {
                add(new THREE.BoxGeometry(2.8, 9, 2.8), stone, half + 3.2, 4.5, 0);
                add(new THREE.BoxGeometry(3.3, 0.5, 3.3), cap, half + 3.2, 9.2, 0);
                for (const [z, ry] of [[1.43, 0], [-1.43, Math.PI]]) {
                    const emblem = new THREE.Mesh(new THREE.CircleGeometry(0.8, 24), new THREE.MeshBasicMaterial({ color: 0xb03030 }));
                    emblem.position.set(half + 3.2, 7.6, z); emblem.rotation.y = ry; g.add(emblem);
                }
            }
            this.scene.add(g);
            this.buildings.push({ mesh: g, name, interactive: true });
        };
        makeGate('雙十南門', 120.687421, 24.14986, 3.2, '國立臺中第一高級中學', true);
        makeGate('雙十北門', 120.688013, 24.151201, 2.8, '臺中一中', false);
        makeGate('一中街側門', 120.685607, 24.150554, 1.6, '臺中一中', false);

        const stele = (name, lon, lat, title) => {
            const p = this.projectMapPoint(lon, lat);
            const g = new THREE.Group();
            g.position.set(p.x, 0, p.z);
            const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.4, 1.2), cap); base.position.y = 0.2; g.add(base);
            const slab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 3, 0.5), new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.6, metalness: 0.1 }));
            slab.position.y = 1.9; slab.castShadow = true; g.add(slab);
            const t = this.textPlane(title, 1.5, 1.2, '#4a4d52', '#e9e4d8', 120);
            t.position.set(0, 2.1, -0.26); t.rotation.y = Math.PI; g.add(t);
            this.scene.add(g);
            this.buildings.push({ mesh: g, name, interactive: true });
        };
        stele('創校紀念碑', 120.68642, 24.14936, '創校紀念碑');
        stele('毋負今日碑', 120.68597, 24.14945, '毋負今日');

        // 光中亭（雙十路側，腳踏車棚與麗澤樓之間；位置為估計）
        const pp = this.projectMapPoint(120.68754, 24.1503);
        const pav = new THREE.Group();
        pav.position.set(pp.x, 0, pp.z);
        const floor = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.3, 4.6), new THREE.MeshStandardMaterial({ color: 0xb9b5aa, roughness: 0.95 }));
        floor.position.y = 0.15; pav.add(floor);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            const col = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 3.2, 12), new THREE.MeshStandardMaterial({ color: 0x8a2f2a, roughness: 0.7 }));
            col.position.set(sx * 1.8, 1.9, sz * 1.8); col.castShadow = true; pav.add(col);
        }
        const roof = new THREE.Mesh(new THREE.ConeGeometry(4.2, 1.9, 4), new THREE.MeshStandardMaterial({ color: 0x4b5b52, roughness: 0.8 }));
        roof.position.y = 4.35; roof.rotation.y = Math.PI / 4; roof.castShadow = true; pav.add(roof);
        this.scene.add(pav);
        this.buildings.push({ mesh: pav, name: '光中亭', interactive: true });
    }

    createMainGate() {
        // 育才街正門（第四代，2016）：鏡面不鏽鋼橢圓形大雨庇（約 9 米高），左側一束白柱圍著玻璃亭，
        // 右側白色圓筒警衛室，中間是扭轉的鏡面柱，頂上有兩個圓形天窗，左後方立著白色細桿鏤空尖塔（三圈環）。
        // 右外側是伸縮鐵門與灰色石牌（校名）。門外是斑馬線、黃色網狀線與橘色三角錐。
        const g = new THREE.Group();
        const mirror = new THREE.MeshStandardMaterial({ color: 0xe4e8eb, metalness: 1, roughness: 0.08, envMap: this.getMirrorEnv(), envMapIntensity: 1.3 });
        const white = new THREE.MeshStandardMaterial({ color: 0xece9e1, roughness: 0.65 });
        const cream = new THREE.MeshStandardMaterial({ color: 0xf3eedc, roughness: 0.5 });
        const glass = new THREE.MeshStandardMaterial({ color: 0x9fb8c4, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.55 });
        const gray = new THREE.MeshStandardMaterial({ color: 0x9a9d9f, roughness: 0.85 });
        const add = (geo, mat, x, y, z, cast = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; g.add(m); return m; };

        // 橢圓（跑道形）鏡面雨庇
        const CW = 36, CD = 11, CY = 7.3;
        const s = new THREE.Shape(), r = CD / 2, hw = CW / 2 - r;
        s.moveTo(-hw, -r); s.lineTo(hw, -r); s.absarc(hw, 0, r, -Math.PI / 2, Math.PI / 2, false);
        s.lineTo(-hw, r); s.absarc(-hw, 0, r, Math.PI / 2, Math.PI * 1.5, false);
        const cg = new THREE.ExtrudeGeometry(s, { depth: 0.9, bevelEnabled: true, bevelThickness: 0.4, bevelSize: 0.4, bevelSegments: 4, curveSegments: 40 });
        cg.rotateX(-Math.PI / 2);
        add(cg, mirror, 0, CY, 0);
        // 雨庇底面的兩個圓形天窗（白色發光）
        for (const [x, rad] of [[-3, 2.3], [10.5, 2.1]]) {
            const d = new THREE.Mesh(new THREE.CircleGeometry(rad, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
            d.rotation.x = Math.PI / 2; d.position.set(x, CY - 0.43, 0.3); g.add(d);
        }
        // 彩色燈泡（新聞：晚上開燈「像酒店」）
        const ledColors = [0xff3b6b, 0xffb02e, 0x3be3ff, 0x7cff5b, 0xb35bff];
        for (let i = 0; i < 24; i++) {
            const side = i % 2 ? 1 : -1, x = -hw + (Math.floor(i / 2) / 11) * hw * 2;
            const led = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), new THREE.MeshBasicMaterial({ color: ledColors[i % 5] }));
            led.position.set(x, CY - 0.55, side * (r - 0.6)); g.add(led);
        }

        // 左：一束白色圓柱圍著玻璃亭
        const leftC = [[-17.3, -2.6], [-16.2, 3.2], [-14.6, -3.6], [-13.4, 3.9], [-11.9, -3.1], [-11.1, 2.6], [-15.1, 0.2]];
        for (const [x, z] of leftC) add(new THREE.CylinderGeometry(0.42, 0.46, CY, 18), white, x, CY / 2, z);
        add(new THREE.CylinderGeometry(2.7, 2.7, 3.4, 28), glass, -14.2, 1.9, 0.2);
        add(new THREE.CylinderGeometry(2.9, 2.9, 0.3, 28), white, -14.2, 0.15, 0.2);
        add(new THREE.CylinderGeometry(3.0, 3.0, 0.25, 28), white, -14.2, 3.65, 0.2);
        // 左外：灰色斜坡護牆與欄杆（無障礙坡道）
        add(new THREE.BoxGeometry(6, 1.6, 9), gray, -21.5, 0.8, 0);
        for (let i = 0; i < 6; i++) add(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), mirror, -24 + i * 1.0, 2.15, 4.3, false);
        add(new THREE.BoxGeometry(6, 0.06, 0.06), mirror, -21.5, 2.7, 4.3, false);

        // 中：扭轉的鏡面柱（一圈圈疊起來、逐層旋轉）＋黑色螺旋飾帶
        const dark = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, metalness: 0.8, roughness: 0.25 });
        for (let i = 0; i < 9; i++) {
            const seg = add(new THREE.CylinderGeometry(1.5, 1.5, 0.74, 24), (i % 3 === 1) ? dark : mirror, 3.8, 0.5 + i * 0.76, 0.4);
            seg.scale.set(1.0, 1, 0.62); seg.rotation.y = i * 0.42;
        }

        // 右：白色大圓筒警衛室（下半玻璃、上半白牆、鏡面頂環）
        add(new THREE.CylinderGeometry(4.3, 4.3, CY, 36), white, 11.5, CY / 2, 0.3);
        add(new THREE.CylinderGeometry(4.36, 4.36, 3.0, 36), glass, 11.5, 2.2, 0.3);
        for (let i = 0; i < 14; i++) {
            const a = i / 14 * Math.PI * 2;
            add(new THREE.BoxGeometry(0.12, 3.0, 0.12), white, 11.5 + Math.cos(a) * 4.38, 2.2, 0.3 + Math.sin(a) * 4.38, false);
        }
        add(new THREE.CylinderGeometry(4.9, 4.9, 0.5, 36), white, 11.5, 4.3, 0.3);

        // 左後方白色鏤空尖塔：8 根細桿向上收攏，三圈橢圓環
        const rodMat = cream;
        const base = new THREE.Vector3(-12.2, CY + 0.4, -1.4);
        const rods = [];
        for (let i = 0; i < 8; i++) {
            const a = i / 8 * Math.PI * 2;
            const lean = 0.8 + (i % 3) * 0.35;                        // 長短不一，像一束竹筍
            const p = new THREE.Vector3(base.x + Math.cos(a) * 1.9, base.y, base.z + Math.sin(a) * 1.9);
            const q = new THREE.Vector3(base.x + Math.cos(a) * 0.12, base.y + 10 + 9 * lean / 1.8, base.z + Math.sin(a) * 0.12);
            const dv = new THREE.Vector3().subVectors(q, p);
            const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, dv.length(), 6), rodMat);
            rod.position.copy(p).addScaledVector(dv, 0.5);
            rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dv.clone().normalize());
            rod.castShadow = true; g.add(rod);
        }
        for (const [h, rad] of [[2.2, 1.75], [7.2, 1.2], [12.2, 0.7]]) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.07, 8, 36), rodMat);
            ring.rotation.x = Math.PI / 2; ring.position.set(base.x, base.y + h, base.z); g.add(ring);
        }
        const tilt = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.05, 8, 36), rodMat);   // 斜環
        tilt.rotation.set(Math.PI / 2.6, 0, 0.4); tilt.position.set(base.x, base.y + 5, base.z); g.add(tilt);

        // 伸縮鐵門（收攏的狀態）＋灰色石牌
        const rail = new THREE.MeshStandardMaterial({ color: 0xbfc4c8, roughness: 0.35, metalness: 0.8 });
        for (let i = 0; i < 30; i++) add(new THREE.BoxGeometry(0.06, 2.0, 0.06), rail, 17.2 + i * 0.28, 1.0, 1.2, false);
        add(new THREE.BoxGeometry(8.4, 0.08, 0.08), rail, 21.4, 1.9, 1.2, false);
        add(new THREE.BoxGeometry(8.4, 0.08, 0.08), rail, 21.4, 0.3, 1.2, false);
        const plaque = add(new THREE.BoxGeometry(5.6, 2.6, 0.9), gray, 28, 1.3, 1.4);
        for (const [z, ry] of [[1.86, 0], [0.94, Math.PI]]) {
            const t = this.textPlane('臺中市立臺中第一高級中等學校', 5.0, 0.9, '#8f9396', '#2d2f31', 66);
            t.position.set(28, 1.7, z); t.rotation.y = ry; g.add(t);
        }

        // 門外：斑馬線、橘色三角錐
        const stripe = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.9 });
        for (let i = 0; i < 9; i++) {
            const st = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 6), stripe);
            st.rotation.x = -Math.PI / 2; st.position.set(-15 + i * 1.9, 0.05, -12.5); g.add(st);
        }
        for (const x of [-20.2, -9, 4.2]) {
            add(new THREE.ConeGeometry(0.35, 0.9, 12), new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6 }), x, 0.45, -7.2);
            add(new THREE.CylinderGeometry(0.4, 0.4, 0.06, 12), new THREE.MeshStandardMaterial({ color: 0x222222 }), x, 0.03, -7.2, false);
        }

        // 鏡頭朝校園時「右手邊」是世界 -x；原本警衛室放在 +x（左手邊）→ 整組左右鏡射。
        // 文字面板再反向鏡射一次，字才不會變成反的。
        g.scale.x = -1;
        g.traverse(o => { if (o.isMesh && o.geometry.type === 'PlaneGeometry' && o.material && o.material.map) o.scale.x = -1; });
        const gatePosition = this.projectMapPoint(120.6862, 24.1493);
        g.position.set(gatePosition.x, 0, gatePosition.z);
        this.scene.add(g);
        this.buildings.push({ mesh: g, name: '校門', interactive: true });
    }

    
    createRudeGate() {
        // 入德之門：校友會於八十週年捐贈的不鏽鋼鏡面雕塑（約 910×450×490 cm），以「八」與「O」為造型。
        // 人從門洞走過，鏡面映出自己；日治時期此處是鐘塔。門前有「入德之球」（傳說跨過它段考會紅字）。
        // 風水說尖角沖煞莊敬樓，所以門後種了幾棵樹擋煞。
        const g = new THREE.Group();
        const mirror = new THREE.MeshStandardMaterial({ color: 0xe4e8eb, metalness: 1, roughness: 0.06, envMap: this.getMirrorEnv(), envMapIntensity: 1.3 });
        const W = 9.1, D = 4.5, H = 4.9, T = 1.0, apexX = 0.45;
        const half = W / 2, dx = half - apexX, len = Math.hypot(dx, H), ang = Math.atan2(dx, H);
        for (const s of [-1, 1]) {               // 「八」：兩片向上收攏的鏡面斜柱
            const leg = new THREE.Mesh(new THREE.BoxGeometry(T, len, D), mirror);
            leg.position.set(s * (half + apexX) / 2, H / 2, 0);
            leg.rotation.z = s * ang;
            leg.castShadow = true; g.add(leg);
        }
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.17, 16, 48), mirror);   // 「O」
        ring.position.set(0, 3.45, 0); ring.castShadow = true; g.add(ring);
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.95, 32, 24), mirror);          // 入德之球（門前）
        ball.position.set(0, 0.95, -D / 2 - 2.6); ball.castShadow = true; g.add(ball);
        const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.1, 24), new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.7 }));
        plinth.position.set(0, 0.05, -D / 2 - 2.6); g.add(plinth);
        for (const [x, z, kind] of [[-5.5, 7.5, 'bischofia'], [0, 9, 'banyan'], [5.5, 7.5, 'bischofia']]) {   // 門後擋煞的樹
            const t = this.makeTree(kind, 0.9, this.seededRandom('rude' + x)); t.position.set(x, 0, z); g.add(t);
        }
        const p = this.projectMapPoint(120.6863167, 24.1494722);
        g.position.set(p.x, 0, p.z);
        this.scene.add(g);
        this.buildings.push({ mesh: g, name: '入德之門', interactive: true });
    }
    
    createZhuangjingBuilding() {
        // 莊敬樓 - 位於校園南側，行政中心，原址為紅樓（1971年啟用）
        // 4層樓建築，設有校長室、教務處、學務處等行政單位
        const buildingGroup = new THREE.Group();
        
        // 主樓 - 4層樓建築（實際高度約16公尺）
        const mainGeometry = new THREE.BoxGeometry(45, 16, 25);
        const buildingMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xF5E6D3,
            roughness: 0.6
        });
        const mainBuilding = new THREE.Mesh(mainGeometry, buildingMaterial);
        mainBuilding.position.set(0, 8, 0);
        mainBuilding.castShadow = true;
        mainBuilding.receiveShadow = true;
        buildingGroup.add(mainBuilding);
        
        // 使用新的細緻屋頂系統
        this.createDetailedRoof(buildingGroup, 45, 25, 0, 16.75, 0, 'flat');
        
        // 屋頂裝飾線條
        const trimGeometry = new THREE.BoxGeometry(48, 0.3, 28);
        const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x654321 });
        const trim = new THREE.Mesh(trimGeometry, trimMaterial);
        trim.position.set(0, 17.5, 0);
        buildingGroup.add(trim);
        
        // 入口門廊
        const porchGeometry = new THREE.BoxGeometry(12, 5, 5);
        const porchMaterial = new THREE.MeshStandardMaterial({ color: 0xE8DCC4 });
        const porch = new THREE.Mesh(porchGeometry, porchMaterial);
        porch.position.set(0, 2.5, 15);
        porch.castShadow = true;
        buildingGroup.add(porch);
        
        // 入口柱子 - 更精細的設計
        for (let i = -5; i <= 5; i += 2.5) {
            const pillarGeometry = new THREE.CylinderGeometry(0.4, 0.5, 5, 16);
            const pillarMaterial = new THREE.MeshStandardMaterial({ 
                color: 0xFFFFFF,
                roughness: 0.3
            });
            const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
            pillar.position.set(i, 5, 17.5);
            pillar.castShadow = true;
            buildingGroup.add(pillar);
            
            // 柱頭
            const capitalGeometry = new THREE.BoxGeometry(1, 0.5, 1);
            const capital = new THREE.Mesh(capitalGeometry, pillarMaterial);
            capital.position.set(i, 7.5, 17.5);
            buildingGroup.add(capital);
        }
        
        // 添加精細門
        this.addDetailedDoor(buildingGroup, 0, 2.5, 17.5, 5, 5);
        
        // 窗戶
        this.addWindows(buildingGroup, 45, 16, 25, 0, 8, 0);
        
        // 添加建築細節
        this.addArchitecturalDetails(buildingGroup, 45, 16, 25, 0, 8, 0);
        
        // 招牌
        this.addSign(buildingGroup, '莊敬樓', 0, 17, 14);
        
        buildingGroup.position.set(0, 0, -80); // 莊敬樓在南側，入德之門後方，精確位置
        this.scene.add(buildingGroup);
        this.buildings.push({ mesh: buildingGroup, name: '莊敬樓', interactive: true });
    }
    
    createJingyeBuilding() {
        // 敬業樓 - 左護廊（西側，雙十路側），1998年新建
        // 5層樓含地下1層，設有社團教室、數學科辦公室、員生社販賣部
        const buildingGroup = new THREE.Group();
        
        const mainGeometry = new THREE.BoxGeometry(35, 18, 15);
        const buildingMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xE8DCC4,
            roughness: 0.6
        });
        const mainBuilding = new THREE.Mesh(mainGeometry, buildingMaterial);
        mainBuilding.position.set(0, 9, 0);
        mainBuilding.castShadow = true;
        mainBuilding.receiveShadow = true;
        buildingGroup.add(mainBuilding);
        
        // 使用新的細緻屋頂系統
        this.createDetailedRoof(buildingGroup, 35, 15, 0, 18.5, 0, 'flat');
        
        this.addWindows(buildingGroup, 35, 18, 15, 0, 9, 0);
        
        // 添加建築細節
        this.addArchitecturalDetails(buildingGroup, 35, 18, 15, 0, 9, 0);
        
        this.addSign(buildingGroup, '敬業樓', 0, 19, 8.5);
        
        buildingGroup.position.set(-50, 0, -40); // 敬業樓在左側（西側），左護廊位置
        this.scene.add(buildingGroup);
        this.buildings.push({ mesh: buildingGroup, name: '敬業樓', interactive: true });
    }
    
    createShensiBuilding() {
        // 慎思樓 - 三大殿之一，中央位置，2008年新樓（7層樓含地下1層）
        // 圖書資訊暨教學大樓，設有圖書室、閱覽室、電腦教室等
        const buildingGroup = new THREE.Group();
        
        const mainGeometry = new THREE.BoxGeometry(40, 22, 18);
        const buildingMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xF0E6D3,
            roughness: 0.6
        });
        const mainBuilding = new THREE.Mesh(mainGeometry, buildingMaterial);
        mainBuilding.position.set(0, 11, 0);
        mainBuilding.castShadow = true;
        mainBuilding.receiveShadow = true;
        buildingGroup.add(mainBuilding);
        
        // 使用新的細緻屋頂系統
        this.createDetailedRoof(buildingGroup, 40, 18, 0, 22.5, 0, 'flat');
        
        // 大門 - 使用精細門設計
        this.addDetailedDoor(buildingGroup, 0, 3.5, 9.5, 5, 7);
        
        // 台階
        for (let i = 0; i < 4; i++) {
            const stepGeometry = new THREE.BoxGeometry(7, 0.3, 1 + i * 0.5);
            const stepMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 });
            const step = new THREE.Mesh(stepGeometry, stepMaterial);
            step.position.set(0, i * 0.3, 10 + i * 0.5);
            step.castShadow = true;
            buildingGroup.add(step);
        }
        
        // 添加陽台
        this.addBalcony(buildingGroup, 0, 16, 9, 12, 4);
        
        this.addWindows(buildingGroup, 40, 22, 18, 0, 11, 0);
        
        // 添加建築細節
        this.addArchitecturalDetails(buildingGroup, 40, 22, 18, 0, 11, 0);
        
        this.addSign(buildingGroup, '慎思樓', 0, 23, 9.5);
        
        buildingGroup.position.set(0, 0, -20); // 慎思樓在中央位置，莊敬樓後方
        this.scene.add(buildingGroup);
        this.buildings.push({ mesh: buildingGroup, name: '慎思樓', interactive: true });
    }
    
    createOldLibrary() {
        // 舊圖書館 - 三大殿之一（已於2008年拆除，為歷史還原）
        // 1971年啟用，原址為圖書館，2008年拆除改建新慎思樓
        const libraryGroup = new THREE.Group();
        
        const mainGeometry = new THREE.BoxGeometry(25, 15, 20);
        const libraryMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xF5E6D3,
            roughness: 0.6
        });
        const library = new THREE.Mesh(mainGeometry, libraryMaterial);
        library.position.set(0, 7.5, 0);
        library.castShadow = true;
        library.receiveShadow = true;
        libraryGroup.add(library);
        
        // 屋頂
        const roofGeometry = new THREE.BoxGeometry(27, 1, 22);
        const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x8B7355 });
        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.set(0, 15.5, 0);
        roof.castShadow = true;
        libraryGroup.add(roof);
        
        this.addWindows(libraryGroup, 25, 15, 20, 0, 7.5, 0);
        this.addSign(libraryGroup, '圖書館', 0, 16, 10.5);
        
        libraryGroup.position.set(30, 0, -30); // 舊圖書館在慎思樓右側，三大殿布局
        this.scene.add(libraryGroup);
        this.buildings.push({ mesh: libraryGroup, name: '舊圖書館', interactive: true });
    }
    
    createLizeBuilding() {
        // 麗澤樓 - 左護廊（西側），藝術樓，1995年新樓
        // 7層樓含地下1層，設有美術教室、烹飪教室、健康中心
        const buildingGroup = new THREE.Group();
        
        const mainGeometry = new THREE.BoxGeometry(30, 16, 14);
        const buildingMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xFFEFD5,
            roughness: 0.6
        });
        const mainBuilding = new THREE.Mesh(mainGeometry, buildingMaterial);
        mainBuilding.position.set(0, 8, 0);
        mainBuilding.castShadow = true;
        mainBuilding.receiveShadow = true;
        buildingGroup.add(mainBuilding);
        
        // 屋頂
        const roofGeometry = new THREE.BoxGeometry(32, 1, 16);
        const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x8B7355 });
        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.set(0, 16.5, 0);
        roof.castShadow = true;
        buildingGroup.add(roof);
        
        this.addWindows(buildingGroup, 30, 16, 14, 0, 8, 0);
        this.addSign(buildingGroup, '麗澤樓', 0, 17, 7.5);
        
        buildingGroup.position.set(-50, 0, 0); // 麗澤樓在敬業樓後方，左護廊位置
        this.scene.add(buildingGroup);
        this.buildings.push({ mesh: buildingGroup, name: '麗澤樓', interactive: true });
    }
    
    createJingxianBuilding() {
        // 景賢樓 - 2005年新建，原址為人文館（2006年完工）
        // 7層樓含地下1層，頂樓設有天信天文台
        const buildingGroup = new THREE.Group();
        
        const mainGeometry = new THREE.BoxGeometry(35, 18, 16);
        const buildingMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xE8DCC4,
            roughness: 0.6
        });
        const mainBuilding = new THREE.Mesh(mainGeometry, buildingMaterial);
        mainBuilding.position.set(0, 9, 0);
        mainBuilding.castShadow = true;
        mainBuilding.receiveShadow = true;
        buildingGroup.add(mainBuilding);
        
        // 屋頂
        const roofGeometry = new THREE.BoxGeometry(37, 1, 18);
        const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x8B7355 });
        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.set(0, 18.5, 0);
        roof.castShadow = true;
        buildingGroup.add(roof);
        
        this.addWindows(buildingGroup, 35, 18, 16, 0, 9, 0);
        this.addSign(buildingGroup, '景賢樓', 0, 19, 8.5);
        
        // 添加天信天文台（在景賢樓頂樓）
        this.createObservatory(buildingGroup, 0, 18, 0);
        
        buildingGroup.position.set(-70, 0, -30); // 景賢樓在左側後方，舊敬業樓位置
        this.scene.add(buildingGroup);
        this.buildings.push({ mesh: buildingGroup, name: '景賢樓', interactive: true });
    }
    
    createScienceBuilding() {
        // 科學館 - 右護廊（東側），1991年新館
        // 4層樓含地下1層，設有物理、化學、生物實驗室
        const buildingGroup = new THREE.Group();
        
        const mainGeometry = new THREE.BoxGeometry(28, 16, 18);
        const buildingMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xC9B896,
            roughness: 0.6
        });
        const mainBuilding = new THREE.Mesh(mainGeometry, buildingMaterial);
        mainBuilding.position.set(0, 8, 0);
        mainBuilding.castShadow = true;
        mainBuilding.receiveShadow = true;
        buildingGroup.add(mainBuilding);
        
        // 屋頂
        const roofGeometry = new THREE.BoxGeometry(30, 1, 20);
        const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x8B7355 });
        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.set(0, 16.5, 0);
        roof.castShadow = true;
        buildingGroup.add(roof);
        
        this.addWindows(buildingGroup, 28, 16, 18, 0, 8, 0);
        this.addSign(buildingGroup, '科學館', 0, 17, 9.5);
        
        buildingGroup.position.set(50, 0, 0); // 科學館在右側（東側），右護廊位置，與麗澤樓對稱
        this.scene.add(buildingGroup);
        this.buildings.push({ mesh: buildingGroup, name: '科學館', interactive: true });
    }
    
    createMingxinBuilding() {
        // 明心館 - 3層樓含地下1層，設有輔導室、校友會辦公室、生涯規劃教室
        const buildingGroup = new THREE.Group();
        
        const mainGeometry = new THREE.BoxGeometry(18, 10, 14);
        const buildingMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xD8C8A8,
            roughness: 0.6
        });
        const mainBuilding = new THREE.Mesh(mainGeometry, buildingMaterial);
        mainBuilding.position.set(0, 5, 0);
        mainBuilding.castShadow = true;
        mainBuilding.receiveShadow = true;
        buildingGroup.add(mainBuilding);
        
        // 屋頂
        const roofGeometry = new THREE.BoxGeometry(20, 1, 16);
        const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x8B7355 });
        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.set(0, 10.5, 0);
        roof.castShadow = true;
        buildingGroup.add(roof);
        
        this.addWindows(buildingGroup, 18, 10, 14, 0, 5, 0);
        this.addSign(buildingGroup, '明心館', 0, 11, 7.5);
        
        buildingGroup.position.set(-30, 0, 50); // 明心館在後方，體育大樓附近
        this.scene.add(buildingGroup);
        this.buildings.push({ mesh: buildingGroup, name: '明心館', interactive: true });
    }
    
    createHistoryMuseum() {
        // 校史館 - 歷史建築，1937年建築（日治時期講堂）
        // 台中市歷史建築，登錄名為「第一中學校講堂」，2015年百年校慶修繕完畢
        const museumGroup = new THREE.Group();
        
        // 主建築 - 日治時期講堂風格
        const mainGeometry = new THREE.BoxGeometry(30, 10, 20);
        const buildingMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xDEB887,
            roughness: 0.7
        });
        const mainBuilding = new THREE.Mesh(mainGeometry, buildingMaterial);
        mainBuilding.position.set(0, 5, 0);
        mainBuilding.castShadow = true;
        mainBuilding.receiveShadow = true;
        museumGroup.add(mainBuilding);
        
        // 日式屋頂
        const roofGeometry = new THREE.BoxGeometry(32, 1.5, 22);
        const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x654321 });
        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.set(0, 10.75, 0);
        roof.castShadow = true;
        museumGroup.add(roof);
        
        // 入口門廊
        const porchGeometry = new THREE.BoxGeometry(6, 4, 3);
        const porchMaterial = new THREE.MeshStandardMaterial({ color: 0xD2B48C });
        const porch = new THREE.Mesh(porchGeometry, porchMaterial);
        porch.position.set(0, 2, 11.5);
        porch.castShadow = true;
        museumGroup.add(porch);
        
        this.addSign(museumGroup, '校史館', 0, 11.5, 10);
        
        museumGroup.position.set(-60, 0, -70); // 校史館在左前方，日治時期位置
        this.scene.add(museumGroup);
        this.buildings.push({ mesh: museumGroup, name: '校史館', interactive: true });
    }
    
    createGuangzhongPavilion() {
        // 光中亭 - 位於雙十路側門，1976年重建
        // 該處原為校內神社，興建於1936年，祀神武天皇，二戰後遭搗毀
        const pavilionGroup = new THREE.Group();
        
        // 基座
        const baseGeometry = new THREE.CylinderGeometry(4, 4.5, 0.5, 8);
        const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 });
        const base = new THREE.Mesh(baseGeometry, baseMaterial);
        base.position.set(0, 0.25, 0);
        base.castShadow = true;
        pavilionGroup.add(base);
        
        // 柱子
        const pillarGeometry = new THREE.CylinderGeometry(0.3, 0.3, 4, 8);
        const pillarMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
            pillar.position.set(Math.cos(angle) * 3, 2.25, Math.sin(angle) * 3);
            pillar.castShadow = true;
            pavilionGroup.add(pillar);
        }
        
        // 屋頂
        const roofGeometry = new THREE.ConeGeometry(5, 2, 8);
        const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x654321 });
        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.set(0, 5.25, 0);
        roof.castShadow = true;
        pavilionGroup.add(roof);
        
        pavilionGroup.position.set(-90, 0, 20); // 光中亭在雙十路側門位置
        this.scene.add(pavilionGroup);
        this.buildings.push({ mesh: pavilionGroup, name: '光中亭', interactive: true });
    }
    
    createMonuments() {
        // 創校紀念碑 - 校門口左側
        const monument1Group = new THREE.Group();
        
        const baseGeometry = new THREE.BoxGeometry(3, 1, 2);
        const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x696969 });
        const base = new THREE.Mesh(baseGeometry, baseMaterial);
        base.position.set(0, 0.5, 0);
        base.castShadow = true;
        monument1Group.add(base);
        
        const stoneGeometry = new THREE.BoxGeometry(2, 3, 1);
        const stoneMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 });
        const stone = new THREE.Mesh(stoneGeometry, stoneMaterial);
        stone.position.set(0, 2.5, 0);
        stone.castShadow = true;
        monument1Group.add(stone);
        
        monument1Group.position.set(-15, 0, -115); // 創校紀念碑在校門口左側
        this.scene.add(monument1Group);
        this.buildings.push({ mesh: monument1Group, name: '創校紀念碑', interactive: true });
        
        // 毋負今日碑 - 校門口右側
        const monument2Group = new THREE.Group();
        
        const base2 = new THREE.Mesh(baseGeometry, baseMaterial);
        base2.position.set(0, 0.5, 0);
        base2.castShadow = true;
        monument2Group.add(base2);
        
        const stone2 = new THREE.Mesh(stoneGeometry, stoneMaterial);
        stone2.position.set(0, 2.5, 0);
        stone2.castShadow = true;
        monument2Group.add(stone2);
        
        monument2Group.position.set(15, 0, -115); // 毋負今日碑在校門口右側
        this.scene.add(monument2Group);
        this.buildings.push({ mesh: monument2Group, name: '毋負今日碑', interactive: true });
    }
    
    createKangleBuilding() {
        // 康樂館 - 右護廊（東側，一中街側），1979年落成
        // 3層樓，設有社團教室（管樂社、數創社、電研社）
        const buildingGroup = new THREE.Group();
        
        const mainGeometry = new THREE.BoxGeometry(22, 12, 16);
        const buildingMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xE0D0B8,
            roughness: 0.6
        });
        const mainBuilding = new THREE.Mesh(mainGeometry, buildingMaterial);
        mainBuilding.position.set(0, 6, 0);
        mainBuilding.castShadow = true;
        mainBuilding.receiveShadow = true;
        buildingGroup.add(mainBuilding);
        
        // 屋頂
        const roofGeometry = new THREE.BoxGeometry(24, 1, 18);
        const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x8B7355 });
        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.set(0, 12.5, 0);
        roof.castShadow = true;
        buildingGroup.add(roof);
        
        this.addWindows(buildingGroup, 22, 12, 16, 0, 6, 0);
        this.addSign(buildingGroup, '康樂館', 0, 13, 8.5);
        
        buildingGroup.position.set(50, 0, -40); // 康樂館在右側（東側），右護廊位置，與敬業樓對稱
        this.scene.add(buildingGroup);
        this.buildings.push({ mesh: buildingGroup, name: '康樂館', interactive: true });
    }
    
    createMusicBuilding() {
        // 音樂館 - 藝能館，1989年起建，3層樓
        // 設有演奏廳、音樂教室、音樂辦公室
        const buildingGroup = new THREE.Group();
        
        const mainGeometry = new THREE.BoxGeometry(20, 10, 15);
        const buildingMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xF0E0D0,
            roughness: 0.6
        });
        const mainBuilding = new THREE.Mesh(mainGeometry, buildingMaterial);
        mainBuilding.position.set(0, 5, 0);
        mainBuilding.castShadow = true;
        mainBuilding.receiveShadow = true;
        buildingGroup.add(mainBuilding);
        
        // 屋頂
        const roofGeometry = new THREE.BoxGeometry(22, 1, 17);
        const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x8B7355 });
        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.set(0, 10.5, 0);
        roof.castShadow = true;
        buildingGroup.add(roof);
        
        this.addWindows(buildingGroup, 20, 10, 15, 0, 5, 0);
        this.addSign(buildingGroup, '音樂館', 0, 11, 8);
        
        buildingGroup.position.set(-40, 0, 60); // 音樂館在左後方，體育大樓附近
        this.scene.add(buildingGroup);
        this.buildings.push({ mesh: buildingGroup, name: '音樂館', interactive: true });
    }
    
    createSportsBuilding() {
        // 體育大樓 - 5層樓，設有綜合運動場、桌球教室、撞球教室、重量訓練室
        const buildingGroup = new THREE.Group();
        
        const mainGeometry = new THREE.BoxGeometry(30, 20, 22);
        const buildingMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xD0C0A8,
            roughness: 0.6
        });
        const mainBuilding = new THREE.Mesh(mainGeometry, buildingMaterial);
        mainBuilding.position.set(0, 10, 0);
        mainBuilding.castShadow = true;
        mainBuilding.receiveShadow = true;
        buildingGroup.add(mainBuilding);
        
        // 屋頂
        const roofGeometry = new THREE.BoxGeometry(32, 1, 24);
        const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x8B7355 });
        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.set(0, 20.5, 0);
        roof.castShadow = true;
        buildingGroup.add(roof);
        
        this.addWindows(buildingGroup, 30, 20, 22, 0, 10, 0);
        this.addSign(buildingGroup, '體育大樓', 0, 21, 11.5);
        
        buildingGroup.position.set(-35, 0, 70); // 體育大樓在後方，精確位置
        this.scene.add(buildingGroup);
        this.buildings.push({ mesh: buildingGroup, name: '體育大樓', interactive: true });
    }
    
    createPlayground() {
        // 操場 - 位於校園後方，400m標準跑道
        const playgroundGeometry = new THREE.PlaneGeometry(80, 50);
        const playgroundMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xCD853F,
            roughness: 0.9
        });
        const playground = new THREE.Mesh(playgroundGeometry, playgroundMaterial);
        playground.rotation.x = -Math.PI / 2;
        playground.position.set(0, 0.1, 100); // 操場在最後方
        playground.receiveShadow = true;
        this.scene.add(playground);
        
        // 跑道 - 400m標準跑道
        const trackGeometry = new THREE.RingGeometry(35, 40, 32);
        const trackMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x8B4513,
            side: THREE.DoubleSide
        });
        const track = new THREE.Mesh(trackGeometry, trackMaterial);
        track.rotation.x = -Math.PI / 2;
        track.position.set(0, 0.15, 100);
        this.scene.add(track);
        
        // 足球場
        const fieldGeometry = new THREE.PlaneGeometry(60, 35);
        const fieldMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x228B22,
            roughness: 0.8
        });
        const field = new THREE.Mesh(fieldGeometry, fieldMaterial);
        field.rotation.x = -Math.PI / 2;
        field.position.set(0, 0.2, 100);
        this.scene.add(field);
        
        // 足球球門
        const goalPostGeometry = new THREE.CylinderGeometry(0.1, 0.1, 2.5, 8);
        const goalPostMaterial = new THREE.MeshStandardMaterial({ color: 0xFFFFFF });
        
        const goal1Left = new THREE.Mesh(goalPostGeometry, goalPostMaterial);
        goal1Left.position.set(-20, 1.25, 117.5);
        this.scene.add(goal1Left);
        
        const goal1Right = new THREE.Mesh(goalPostGeometry, goalPostMaterial);
        goal1Right.position.set(20, 1.25, 117.5);
        this.scene.add(goal1Right);
        
        const goal2Left = new THREE.Mesh(goalPostGeometry, goalPostMaterial);
        goal2Left.position.set(-20, 1.25, 82.5);
        this.scene.add(goal2Left);
        
        const goal2Right = new THREE.Mesh(goalPostGeometry, goalPostMaterial);
        goal2Right.position.set(20, 1.25, 82.5);
        this.scene.add(goal2Right);
    }
    
    createBikeShed() {
        // 腳踏車棚 - 位於光中亭附近
        const shedGroup = new THREE.Group();
        
        // 主結構
        const roofGeometry = new THREE.BoxGeometry(15, 0.5, 8);
        const roofMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x2F4F4F,
            roughness: 0.7
        });
        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.set(0, 3, 0);
        roof.castShadow = true;
        shedGroup.add(roof);
        
        // 支柱
        const pillarGeometry = new THREE.CylinderGeometry(0.15, 0.15, 3, 8);
        const pillarMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 });
        
        const pillarPositions = [
            [-6, 0, -3], [6, 0, -3], [-6, 0, 3], [6, 0, 3],
            [-6, 0, 0], [6, 0, 0], [0, 0, -3], [0, 0, 3]
        ];
        
        pillarPositions.forEach(pos => {
            const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
            pillar.position.set(pos[0], 1.5, pos[1]);
            pillar.castShadow = true;
            shedGroup.add(pillar);
        });
        
        // 地面
        const floorGeometry = new THREE.PlaneGeometry(14, 7);
        const floorMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x696969,
            roughness: 0.9
        });
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(0, 0.05, 0);
        floor.receiveShadow = true;
        shedGroup.add(floor);
        
        shedGroup.position.set(-45, 0, 20);
        this.scene.add(shedGroup);
        this.buildings.push({ mesh: shedGroup, name: '腳踏車棚', interactive: true });
    }
    
    createCamphorGarden() {
        // 樟園 - 位於校史館後方，有林獻堂手植的樟樹
        const gardenGroup = new THREE.Group();
        
        // 圍欄
        const fenceMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x8B4513,
            roughness: 0.8
        });
        
        for (let i = -5; i <= 5; i++) {
            const postGeometry = new THREE.BoxGeometry(0.3, 1.5, 0.3);
            const post = new THREE.Mesh(postGeometry, fenceMaterial);
            post.position.set(i * 2, 0.75, -8);
            post.castShadow = true;
            gardenGroup.add(post);
            
            const post2 = new THREE.Mesh(postGeometry, fenceMaterial);
            post2.position.set(i * 2, 0.75, 8);
            post2.castShadow = true;
            gardenGroup.add(post2);
        }
        
        // 林獻堂手植的兩株樟樹（特別標記）
        const specialTreePositions = [
            [-3, 0], [3, 0]
        ];
        
        specialTreePositions.forEach(pos => {
            const treeGroup = new THREE.Group();
            
            // 更大的樹幹
            const trunkGeometry = new THREE.CylinderGeometry(0.8, 1.2, 5, 12);
            const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x654321 });
            const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
            trunk.position.set(0, 2.5, 0);
            trunk.castShadow = true;
            treeGroup.add(trunk);
            
            // 更大的樹冠
            const foliageGeometry = new THREE.SphereGeometry(4, 12, 12);
            const foliageMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x228B22,
                roughness: 0.7
            });
            const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
            foliage.position.set(0, 7, 0);
            foliage.castShadow = true;
            treeGroup.add(foliage);
            
            // 樹冠層次
            const foliage2Geometry = new THREE.SphereGeometry(3, 10, 10);
            const foliage2 = new THREE.Mesh(foliage2Geometry, foliageMaterial);
            foliage2.position.set(0, 9, 0);
            treeGroup.add(foliage2);
            
            treeGroup.position.set(pos[0], 0, pos[1]);
            gardenGroup.add(treeGroup);
        });
        
        // 其他小樹
        const smallTreePositions = [
            [-6, -3], [6, -3], [-6, 3], [6, 3],
            [-2, -5], [2, -5], [-2, 5], [2, 5]
        ];
        
        smallTreePositions.forEach(pos => {
            const treeGroup = new THREE.Group();
            
            const trunkGeometry = new THREE.CylinderGeometry(0.2, 0.3, 2, 8);
            const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
            const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
            trunk.position.set(0, 1, 0);
            trunk.castShadow = true;
            treeGroup.add(trunk);
            
            const foliageGeometry = new THREE.SphereGeometry(1.5, 8, 8);
            const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22 });
            const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
            foliage.position.set(0, 2.5, 0);
            foliage.castShadow = true;
            treeGroup.add(foliage);
            
            treeGroup.position.set(pos[0], 0, pos[1]);
            gardenGroup.add(treeGroup);
        });
        
        // 溫室
        const greenhouseGeometry = new THREE.BoxGeometry(4, 3, 3);
        const greenhouseMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x98FB98,
            transparent: true,
            opacity: 0.6,
            roughness: 0.2
        });
        const greenhouse = new THREE.Mesh(greenhouseGeometry, greenhouseMaterial);
        greenhouse.position.set(0, 1.5, -5);
        greenhouse.castShadow = true;
        gardenGroup.add(greenhouse);
        
        gardenGroup.position.set(-60, 0, -50); // 樟園在校史館後方，精確位置
        this.scene.add(gardenGroup);
        this.buildings.push({ mesh: gardenGroup, name: '樟園', interactive: true });
    }
    
    createGreenhouse() {
        // 溫室植物園 - 位於育才街側，2015年百年校慶新建
        const greenhouseGroup = new THREE.Group();
        
        // 主結構
        const mainGeometry = new THREE.BoxGeometry(12, 6, 8);
        const glassMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x98FB98,
            transparent: true,
            opacity: 0.5,
            roughness: 0.1,
            metalness: 0.3
        });
        const main = new THREE.Mesh(mainGeometry, glassMaterial);
        main.position.set(0, 3, 0);
        main.castShadow = true;
        greenhouseGroup.add(main);
        
        // 金屬框架
        const frameMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x2F4F4F,
            roughness: 0.4
        });
        
        // 垂直框架
        for (let i = -5; i <= 5; i++) {
            const vFrameGeometry = new THREE.BoxGeometry(0.1, 6, 0.1);
            const vFrame = new THREE.Mesh(vFrameGeometry, frameMaterial);
            vFrame.position.set(i, 3, -4);
            greenhouseGroup.add(vFrame);
            
            const vFrame2 = new THREE.Mesh(vFrameGeometry, frameMaterial);
            vFrame2.position.set(i, 3, 4);
            greenhouseGroup.add(vFrame2);
        }
        
        // 水平框架
        for (let i = -3; i <= 3; i++) {
            const hFrameGeometry = new THREE.BoxGeometry(12, 0.1, 0.1);
            const hFrame = new THREE.Mesh(hFrameGeometry, frameMaterial);
            hFrame.position.set(0, i, -4);
            greenhouseGroup.add(hFrame);
            
            const hFrame2 = new THREE.Mesh(hFrameGeometry, frameMaterial);
            hFrame2.position.set(0, i, 4);
            greenhouseGroup.add(hFrame2);
        }
        
        // 屋頂框架
        const roofFrameGeometry = new THREE.BoxGeometry(12, 0.1, 8);
        const roofFrame = new THREE.Mesh(roofFrameGeometry, frameMaterial);
        roofFrame.position.set(0, 6, 0);
        greenhouseGroup.add(roofFrame);
        
        // 植物盆栽
        const potMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        const plantMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22 });
        
        for (let i = 0; i < 8; i++) {
            const potGeometry = new THREE.CylinderGeometry(0.4, 0.5, 0.6, 8);
            const pot = new THREE.Mesh(potGeometry, potMaterial);
            pot.position.set(-4 + i * 1.2, 0.3, 0);
            greenhouseGroup.add(pot);
            
            const plantGeometry = new THREE.SphereGeometry(0.5, 8, 8);
            const plant = new THREE.Mesh(plantGeometry, plantMaterial);
            plant.position.set(-4 + i * 1.2, 1, 0);
            greenhouseGroup.add(plant);
        }
        
        greenhouseGroup.position.set(-25, 0, -100); // 溫室植物園在育才街側，2015年新建位置
        this.scene.add(greenhouseGroup);
        this.buildings.push({ mesh: greenhouseGroup, name: '溫室植物園', interactive: true });
    }
    
    createDormitory() {
        // 學生宿舍
        const dormGroup = new THREE.Group();
        
        // 主樓
        const mainGeometry = new THREE.BoxGeometry(25, 15, 12);
        const dormMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xE8DCC4,
            roughness: 0.6
        });
        const main = new THREE.Mesh(mainGeometry, dormMaterial);
        main.position.set(0, 7.5, 0);
        main.castShadow = true;
        main.receiveShadow = true;
        dormGroup.add(main);
        
        // 屋頂
        const roofGeometry = new THREE.BoxGeometry(27, 1, 14);
        const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x8B7355 });
        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.set(0, 15.5, 0);
        roof.castShadow = true;
        dormGroup.add(roof);
        
        // 窗戶
        this.addWindows(dormGroup, 25, 15, 12, 0, 7.5, 0);
        
        // 入口
        this.addDetailedDoor(dormGroup, 0, 2, 6.5, 3, 4);
        
        // 招牌
        this.addSign(dormGroup, '學生宿舍', 0, 16, 7);
        
        dormGroup.position.set(70, 0, 60);
        this.scene.add(dormGroup);
        this.buildings.push({ mesh: dormGroup, name: '學生宿舍', interactive: true });
    }
    
    createSwimmingPool() {
        // 游泳池
        const poolGroup = new THREE.Group();
        
        // 池底
        const poolBottomGeometry = new THREE.PlaneGeometry(20, 10);
        const poolMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x1E90FF,
            roughness: 0.2,
            metalness: 0.1
        });
        const poolBottom = new THREE.Mesh(poolBottomGeometry, poolMaterial);
        poolBottom.rotation.x = -Math.PI / 2;
        poolBottom.position.set(0, -1.5, 0);
        poolGroup.add(poolBottom);
        
        // 池壁
        const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 });
        
        // 長邊池壁
        const longWallGeometry = new THREE.BoxGeometry(20, 2, 0.5);
        const wall1 = new THREE.Mesh(longWallGeometry, wallMaterial);
        wall1.position.set(0, 0, -5);
        poolGroup.add(wall1);
        
        const wall2 = new THREE.Mesh(longWallGeometry, wallMaterial);
        wall2.position.set(0, 0, 5);
        poolGroup.add(wall2);
        
        // 短邊池壁
        const shortWallGeometry = new THREE.BoxGeometry(0.5, 2, 10);
        const wall3 = new THREE.Mesh(shortWallGeometry, wallMaterial);
        wall3.position.set(-10, 0, 0);
        poolGroup.add(wall3);
        
        const wall4 = new THREE.Mesh(shortWallGeometry, wallMaterial);
        wall4.position.set(10, 0, 0);
        poolGroup.add(wall4);
        
        // 水面
        const waterGeometry = new THREE.PlaneGeometry(19, 9);
        const waterMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x00BFFF,
            transparent: true,
            opacity: 0.7,
            roughness: 0.1
        });
        const water = new THREE.Mesh(waterGeometry, waterMaterial);
        water.rotation.x = -Math.PI / 2;
        water.position.set(0, 0.1, 0);
        poolGroup.add(water);
        
        // 更衣室
        const lockerGeometry = new THREE.BoxGeometry(6, 4, 4);
        const lockerMaterial = new THREE.MeshStandardMaterial({ color: 0xD2B48C });
        const locker = new THREE.Mesh(lockerGeometry, lockerMaterial);
        locker.position.set(15, 2, 0);
        locker.castShadow = true;
        poolGroup.add(locker);
        
        poolGroup.position.set(40, 0, 90);
        this.scene.add(poolGroup);
        this.buildings.push({ mesh: poolGroup, name: '游泳池', interactive: true });
    }
    
    createBasketballCourts() {
        // 籃球場
        const courtGroup = new THREE.Group();
        
        const courtGeometry = new THREE.PlaneGeometry(15, 28);
        const courtMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xCD853F,
            roughness: 0.9
        });
        
        // 創建2個籃球場
        for (let i = 0; i < 2; i++) {
            const court = new THREE.Mesh(courtGeometry, courtMaterial);
            court.rotation.x = -Math.PI / 2;
            court.position.set(-10 + i * 20, 0.1, 0);
            court.receiveShadow = true;
            courtGroup.add(court);
            
            // 篮柱
            const poleGeometry = new THREE.CylinderGeometry(0.1, 0.1, 3, 8);
            const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x2F4F4F });
            
            const pole1 = new THREE.Mesh(poleGeometry, poleMaterial);
            pole1.position.set(-10 + i * 20 - 7, 1.5, -13);
            courtGroup.add(pole1);
            
            const pole2 = new THREE.Mesh(poleGeometry, poleMaterial);
            pole2.position.set(-10 + i * 20 + 7, 1.5, 13);
            courtGroup.add(pole2);
            
            // 篮板
            const backboardGeometry = new THREE.BoxGeometry(1.8, 1.2, 0.1);
            const backboardMaterial = new THREE.MeshStandardMaterial({ color: 0xFFFFFF });
            
            const backboard1 = new THREE.Mesh(backboardGeometry, backboardMaterial);
            backboard1.position.set(-10 + i * 20 - 7, 3, -13);
            courtGroup.add(backboard1);
            
            const backboard2 = new THREE.Mesh(backboardGeometry, backboardMaterial);
            backboard2.position.set(-10 + i * 20 + 7, 3, 13);
            courtGroup.add(backboard2);
        }
        
        courtGroup.position.set(-30, 0, 70);
        this.scene.add(courtGroup);
        this.buildings.push({ mesh: courtGroup, name: '籃球場', interactive: true });
    }
    
    createVolleyballCourts() {
        // 排球場
        const courtGroup = new THREE.Group();
        
        const courtGeometry = new THREE.PlaneGeometry(18, 9);
        const courtMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xFFA500,
            roughness: 0.9
        });
        
        for (let i = 0; i < 2; i++) {
            const court = new THREE.Mesh(courtGeometry, courtMaterial);
            court.rotation.x = -Math.PI / 2;
            court.position.set(-10 + i * 20, 0.1, 0);
            court.receiveShadow = true;
            courtGroup.add(court);
            
            // 網柱
            const netPoleGeometry = new THREE.CylinderGeometry(0.08, 0.08, 2.5, 8);
            const netPoleMaterial = new THREE.MeshStandardMaterial({ color: 0x2F4F4F });
            
            const netPole1 = new THREE.Mesh(netPoleGeometry, netPoleMaterial);
            netPole1.position.set(-10 + i * 20 - 8, 1.25, 0);
            courtGroup.add(netPole1);
            
            const netPole2 = new THREE.Mesh(netPoleGeometry, netPoleMaterial);
            netPole2.position.set(-10 + i * 20 + 8, 1.25, 0);
            courtGroup.add(netPole2);
            
            // 球網
            const netGeometry = new THREE.PlaneGeometry(16, 1);
            const netMaterial = new THREE.MeshStandardMaterial({ 
                color: 0xFFFFFF,
                transparent: true,
                opacity: 0.5
            });
            const net = new THREE.Mesh(netGeometry, netMaterial);
            net.rotation.x = Math.PI / 2;
            net.position.set(-10 + i * 20, 1.8, 0);
            courtGroup.add(net);
        }
        
        courtGroup.position.set(20, 0, 70);
        this.scene.add(courtGroup);
        this.buildings.push({ mesh: courtGroup, name: '排球場', interactive: true });
    }
    
    createTennisCourts() {
        // 網球場
        const courtGroup = new THREE.Group();
        
        const courtGeometry = new THREE.PlaneGeometry(24, 11);
        const courtMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x228B22,
            roughness: 0.8
        });
        
        for (let i = 0; i < 2; i++) {
            const court = new THREE.Mesh(courtGeometry, courtMaterial);
            court.rotation.x = -Math.PI / 2;
            court.position.set(-13 + i * 26, 0.1, 0);
            court.receiveShadow = true;
            courtGroup.add(court);
            
            // 網柱
            const netPoleGeometry = new THREE.CylinderGeometry(0.08, 0.08, 1.2, 8);
            const netPoleMaterial = new THREE.MeshStandardMaterial({ color: 0x2F4F4F });
            
            const netPole1 = new THREE.Mesh(netPoleGeometry, netPoleMaterial);
            netPole1.position.set(-13 + i * 26 - 10, 0.6, 0);
            courtGroup.add(netPole1);
            
            const netPole2 = new THREE.Mesh(netPoleGeometry, netPoleMaterial);
            netPole2.position.set(-13 + i * 26 + 10, 0.6, 0);
            courtGroup.add(netPole2);
            
            // 球網
            const netGeometry = new THREE.PlaneGeometry(20, 0.9);
            const netMaterial = new THREE.MeshStandardMaterial({ 
                color: 0xFFFFFF,
                transparent: true,
                opacity: 0.6
            });
            const net = new THREE.Mesh(netGeometry, netMaterial);
            net.rotation.x = Math.PI / 2;
            net.position.set(-13 + i * 26, 0.9, 0);
            courtGroup.add(net);
        }
        
        courtGroup.position.set(0, 0, 50);
        this.scene.add(courtGroup);
        this.buildings.push({ mesh: courtGroup, name: '網球場', interactive: true });
    }
    
    createOpenStage() {
        // 露天舞台 - 慎思樓前，2015年百年校慶新建
        const stageGroup = new THREE.Group();
        
        // 舞台地板
        const stageGeometry = new THREE.BoxGeometry(15, 0.5, 8);
        const stageMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x8B4513,
            roughness: 0.8
        });
        const stage = new THREE.Mesh(stageGeometry, stageMaterial);
        stage.position.set(0, 0.25, 0);
        stage.castShadow = true;
        stage.receiveShadow = true;
        stageGroup.add(stage);
        
        // 台階
        for (let i = 1; i <= 3; i++) {
            const stepGeometry = new THREE.BoxGeometry(15 + i * 2, 0.3, 1.5);
            const step = new THREE.Mesh(stepGeometry, stageMaterial);
            step.position.set(0, i * 0.3, 4 + i * 1.5);
            step.castShadow = true;
            stageGroup.add(step);
        }
        
        // 背景牆
        const backWallGeometry = new THREE.BoxGeometry(16, 4, 0.5);
        const wallMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xE8DCC4,
            roughness: 0.6
        });
        const backWall = new THREE.Mesh(backWallGeometry, wallMaterial);
        backWall.position.set(0, 2.5, -4.5);
        backWall.castShadow = true;
        stageGroup.add(backWall);
        
        // 音響設備
        const speakerGeometry = new THREE.BoxGeometry(1, 2, 0.5);
        const speakerMaterial = new THREE.MeshStandardMaterial({ color: 0x2F4F4F });
        
        const speaker1 = new THREE.Mesh(speakerGeometry, speakerMaterial);
        speaker1.position.set(-7, 3, -4);
        stageGroup.add(speaker1);
        
        const speaker2 = new THREE.Mesh(speakerGeometry, speakerMaterial);
        speaker2.position.set(7, 3, -4);
        stageGroup.add(speaker2);
        
        stageGroup.position.set(0, 0, -5); // 露天舞台在慎思樓前，精確位置
        this.scene.add(stageGroup);
        this.buildings.push({ mesh: stageGroup, name: '露天舞台', interactive: true });
    }
    
    createPaths() {
        // 校園道路 - 根據實際校園配置精確調整
        const pathMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x808080,
            roughness: 0.9
        });
        
        // 主要道路 - 從校門到中央區域（育才街到尊賢街方向）
        const mainPathGeometry = new THREE.PlaneGeometry(6, 100);
        const mainPath = new THREE.Mesh(mainPathGeometry, pathMaterial);
        mainPath.rotation.x = -Math.PI / 2;
        mainPath.position.set(0, 0.05, -70);
        this.scene.add(mainPath);
        
        // 橫向道路 - 連接左右建築群（三大殿前）
        const crossPathGeometry = new THREE.PlaneGeometry(140, 5);
        const crossPath = new THREE.Mesh(crossPathGeometry, pathMaterial);
        crossPath.rotation.x = -Math.PI / 2;
        crossPath.position.set(0, 0.05, -20);
        this.scene.add(crossPath);
        
        // 左側道路 - 通往敬業樓、麗澤樓（雙十路側）
        const leftPathGeometry = new THREE.PlaneGeometry(5, 80);
        const leftPath = new THREE.Mesh(leftPathGeometry, pathMaterial);
        leftPath.rotation.x = -Math.PI / 2;
        leftPath.position.set(-50, 0.05, -20);
        this.scene.add(leftPath);
        
        // 右側道路 - 通往科學館、康樂館（一中街側）
        const rightPathGeometry = new THREE.PlaneGeometry(5, 80);
        const rightPath = new THREE.Mesh(rightPathGeometry, pathMaterial);
        rightPath.rotation.x = -Math.PI / 2;
        rightPath.position.set(50, 0.05, -20);
        this.scene.add(rightPath);
        
        // 後方道路 - 通往操場
        const backPathGeometry = new THREE.PlaneGeometry(120, 5);
        const backPath = new THREE.Mesh(backPathGeometry, pathMaterial);
        backPath.rotation.x = -Math.PI / 2;
        backPath.position.set(0, 0.05, 40);
        this.scene.add(backPath);
        
        // 添加樹木
        this.createTrees();
        
        // 添加長椅
        this.createBenches();
        
        // 添加路燈
        this.createStreetLights();
    }
    
    createTrees() {
        // 根據實際校園配置精確調整樹木位置 - 升級版
        const treePositions = [
            // 校門附近
            [-20, -110], [20, -110], [-25, -95], [25, -95],
            // 左側建築群附近（雙十路側）
            [-65, -50], [-70, -30], [-65, -10], [-60, 10],
            // 右側建築群附近（一中街側）
            [65, -50], [70, -30], [65, -10], [60, 10],
            // 中央三大殿區域
            [-15, -60], [15, -60], [-20, -30], [20, -30],
            // 後方區域
            [-35, 60], [35, 60], [-25, 80], [25, 80],
            // 校史館附近
            [-55, -75], [-65, -65],
            // 光中亭附近
            [-85, 10], [-95, 30]
        ];
        
        treePositions.forEach(pos => {
            const treeGroup = new THREE.Group();
            
            // 樹幹 - 更真實的樹幹
            const trunkGeometry = new THREE.CylinderGeometry(0.3, 0.5, 3, 8);
            const trunkMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x8B4513,
                roughness: 0.8
            });
            const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
            trunk.position.set(0, 1.5, 0);
            trunk.castShadow = true;
            treeGroup.add(trunk);
            
            // 樹冠 - 多層次樹冠
            const foliageMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x228B22,
                roughness: 0.7
            });
            
            // 主樹冠
            const foliageGeometry = new THREE.SphereGeometry(2, 8, 8);
            const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
            foliage.position.set(0, 4, 0);
            foliage.castShadow = true;
            treeGroup.add(foliage);
            
            // 第二層樹冠
            const foliage2Geometry = new THREE.SphereGeometry(1.5, 6, 6);
            const foliage2 = new THREE.Mesh(foliage2Geometry, foliageMaterial);
            foliage2.position.set(0, 5.5, 0);
            foliage2.castShadow = true;
            treeGroup.add(foliage2);
            
            // 第三層樹冠
            const foliage3Geometry = new THREE.SphereGeometry(1, 4, 4);
            const foliage3 = new THREE.Mesh(foli3Geometry, foliageMaterial);
            foliage3.position.set(0, 6.5, 0);
            foliage3.castShadow = true;
            treeGroup.add(foli3);
            
            // 樹枝
            const branchGeometry = new THREE.CylinderGeometry(0.05, 0.08, 1.5, 6);
            const branchMaterial = new THREE.MeshStandardMaterial({ color: 0x654321 });
            
            for (let i = 0; i < 4; i++) {
                const angle = (i / 4) * Math.PI * 2;
                const branch = new THREE.Mesh(branchGeometry, branchMaterial);
                branch.position.set(
                    Math.cos(angle) * 1.5,
                    3,
                    Math.sin(angle) * 1.5
                );
                branch.rotation.z = angle;
                branch.castShadow = true;
                treeGroup.add(branch);
            }
            
            treeGroup.position.set(pos[0], 0, pos[1]);
            this.scene.add(treeGroup);
            this.coverZones.push({ x: pos[0], z: pos[1], radius: 3.6 });
        });
    }
    
    createBenches() {
        // 根據實際校園配置精確調整長椅位置
        const benchPositions = [
            // 中央道路旁
            [-8, -50], [8, -50], [-8, -20], [8, -20],
            // 左側建築群旁（雙十路側）
            [-45, -40], [-45, -10], [-55, -25],
            // 右側建築群旁（一中街側）
            [45, -40], [45, -10], [55, -25],
            // 後方區域
            [-15, 50], [15, 50], [0, 60],
            // 三大殿前
            [-10, -10], [10, -10]
        ];
        
        benchPositions.forEach(pos => {
            const benchGroup = new THREE.Group();
            
            // 座椅
            const seatGeometry = new THREE.BoxGeometry(2, 0.1, 0.5);
            const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
            const seat = new THREE.Mesh(seatGeometry, woodMaterial);
            seat.position.set(0, 0.5, 0);
            seat.castShadow = true;
            benchGroup.add(seat);
            
            // 腿
            const legGeometry = new THREE.BoxGeometry(0.1, 0.5, 0.4);
            const metalMaterial = new THREE.MeshStandardMaterial({ color: 0x2F4F4F });
            
            const leg1 = new THREE.Mesh(legGeometry, metalMaterial);
            leg1.position.set(-0.8, 0.25, 0);
            benchGroup.add(leg1);
            
            const leg2 = new THREE.Mesh(legGeometry, metalMaterial);
            leg2.position.set(0.8, 0.25, 0);
            benchGroup.add(leg2);
            
            benchGroup.position.set(pos[0], 0, pos[1]);
            this.scene.add(benchGroup);
        });
    }
    
    createStreetLights() {
        // 根據實際校園配置精確調整路燈位置
        const lightPositions = [
            // 主要道路兩側（育才街到尊賢街）
            [-4, -100], [4, -100], [-4, -80], [4, -80],
            [-4, -60], [4, -60], [-4, -40], [4, -40],
            // 橫向道路兩側（三大殿前）
            [-50, -24], [-30, -24], [-10, -24], [10, -24], [30, -24], [50, -24],
            // 左側道路（雙十路側）
            [-54, -40], [-54, -20], [-54, 0],
            // 右側道路（一中街側）
            [54, -40], [54, -20], [54, 0],
            // 後方道路
            [-40, 44], [-20, 44], [20, 44], [40, 44]
        ];
        
        lightPositions.forEach(pos => {
            const lightGroup = new THREE.Group();
            
            // 柱子
            const poleGeometry = new THREE.CylinderGeometry(0.1, 0.15, 5, 8);
            const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x2F4F4F });
            const pole = new THREE.Mesh(poleGeometry, poleMaterial);
            pole.position.set(0, 2.5, 0);
            pole.castShadow = true;
            lightGroup.add(pole);
            
            // 燈罩
            const lampGeometry = new THREE.SphereGeometry(0.3, 8, 8);
            const lampMaterial = new THREE.MeshStandardMaterial({ 
                color: 0xFFFFE0,
                emissive: 0xFFFFE0,
                emissiveIntensity: 0.5
            });
            const lamp = new THREE.Mesh(lampGeometry, lampMaterial);
            lamp.position.set(0, 5.2, 0);
            lightGroup.add(lamp);
            
            lightGroup.position.set(pos[0], 0, pos[1]);
            this.scene.add(lightGroup);
        });
    }
    
    addWindows(buildingGroup, width, height, depth, x, y, z) {
        // 更真實的窗戶材質 - 升級版
        const glassMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x87CEEB,
            roughness: 0.1,
            metalness: 0.8,
            transparent: true,
            opacity: 0.6
        });
        
        const frameMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x2F4F4F,
            roughness: 0.5
        });
        
        const windowWidth = 1.8;
        const windowHeight = 2.4;
        const windowSpacingX = 3.5;
        const windowSpacingY = 3.5;
        
        // 窗戶幾何體（所有窗戶共用）
        const windowGeometry = new THREE.PlaneGeometry(windowWidth, windowHeight);
        const frameGeometry = new THREE.BoxGeometry(windowWidth + 0.15, windowHeight + 0.15, 0.08);
        
        // 窗戶分隔線（十字形）
        const dividerHGeometry = new THREE.BoxGeometry(windowWidth + 0.1, 0.08, 0.06);
        const dividerVGeometry = new THREE.BoxGeometry(0.08, windowHeight + 0.1, 0.06);
        
        // 前面窗戶
        for (let i = 0; i < Math.floor((width - 2) / windowSpacingX); i++) {
            for (let j = 0; j < Math.floor((height - 2) / windowSpacingY); j++) {
                const windowX = x - width/2 + windowSpacingX/2 + i * windowSpacingX;
                const windowY = y - height/2 + windowSpacingY/2 + j * windowSpacingY + 1;
                
                // 窗戶玻璃
                const windowMesh = new THREE.Mesh(windowGeometry, glassMaterial);
                windowMesh.position.set(windowX, windowY, z + depth/2 + 0.15);
                buildingGroup.add(windowMesh);
                
                // 窗戶框架
                const frameMesh = new THREE.Mesh(frameGeometry, frameMaterial);
                frameMesh.position.set(windowX, windowY, z + depth/2 + 0.12);
                buildingGroup.add(frameMesh);
                
                // 窗戶分隔線
                const dividerH = new THREE.Mesh(dividerHGeometry, frameMaterial);
                dividerH.position.set(windowX, windowY, z + depth/2 + 0.14);
                buildingGroup.add(dividerH);
                
                const dividerV = new THREE.Mesh(dividerVGeometry, frameMaterial);
                dividerV.position.set(windowX, windowY, z + depth/2 + 0.14);
                buildingGroup.add(dividerV);
            }
        }
        
        // 後面窗戶
        for (let i = 0; i < Math.floor((width - 2) / windowSpacingX); i++) {
            for (let j = 0; j < Math.floor((height - 2) / windowSpacingY); j++) {
                const windowX = x - width/2 + windowSpacingX/2 + i * windowSpacingX;
                const windowY = y - height/2 + windowSpacingY/2 + j * windowSpacingY + 1;
                
                const windowMesh = new THREE.Mesh(windowGeometry, glassMaterial);
                windowMesh.position.set(windowX, windowY, z - depth/2 - 0.15);
                windowMesh.rotation.y = Math.PI;
                buildingGroup.add(windowMesh);
                
                const frameMesh = new THREE.Mesh(frameGeometry, frameMaterial);
                frameMesh.position.set(windowX, windowY, z - depth/2 - 0.12);
                frameMesh.rotation.y = Math.PI;
                buildingGroup.add(frameMesh);
                
                const dividerH = new THREE.Mesh(dividerHGeometry, frameMaterial);
                dividerH.position.set(windowX, windowY, z - depth/2 - 0.14);
                dividerH.rotation.y = Math.PI;
                buildingGroup.add(dividerH);
                
                const dividerV = new THREE.Mesh(dividerVGeometry, frameMaterial);
                dividerV.position.set(windowX, windowY, z - depth/2 - 0.14);
                dividerV.rotation.y = Math.PI;
                buildingGroup.add(dividerV);
            }
        }
        
        // 側面窗戶
        for (let i = 0; i < Math.floor((depth - 2) / windowSpacingX); i++) {
            for (let j = 0; j < Math.floor((height - 2) / windowSpacingY); j++) {
                const windowY = y - height/2 + windowSpacingY/2 + j * windowSpacingY + 1;
                const windowZ = z - depth/2 + windowSpacingX/2 + i * windowSpacingX;
                
                // 左側
                const windowMesh1 = new THREE.Mesh(windowGeometry, glassMaterial);
                windowMesh1.position.set(x - width/2 - 0.15, windowY, windowZ);
                windowMesh1.rotation.y = -Math.PI / 2;
                buildingGroup.add(windowMesh1);
                
                const frameMesh1 = new THREE.Mesh(frameGeometry, frameMaterial);
                frameMesh1.position.set(x - width/2 - 0.12, windowY, windowZ);
                frameMesh1.rotation.y = -Math.PI / 2;
                buildingGroup.add(frameMesh1);
                
                // 右側
                const windowMesh2 = new THREE.Mesh(windowGeometry, glassMaterial);
                windowMesh2.position.set(x + width/2 + 0.15, windowY, windowZ);
                windowMesh2.rotation.y = Math.PI / 2;
                buildingGroup.add(windowMesh2);
                
                const frameMesh2 = new THREE.Mesh(frameGeometry, frameMaterial);
                frameMesh2.position.set(x + width/2 + 0.12, windowY, windowZ);
                frameMesh2.rotation.y = Math.PI / 2;
                buildingGroup.add(frameMesh2);
            }
        }
    }
    
    addSign(buildingGroup, text, x, y, z) {
        // 創建更精緻的招牌
        const signWidth = text.length * 1.2 + 1;
        const signHeight = 2;
        
        // 招牌背景
        const signGeometry = new THREE.BoxGeometry(signWidth, signHeight, 0.3);
        const signMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x2C3E50,
            roughness: 0.3,
            metalness: 0.2
        });
        const sign = new THREE.Mesh(signGeometry, signMaterial);
        sign.position.set(x, y, z);
        sign.castShadow = true;
        buildingGroup.add(sign);
        
        // 招牌邊框
        const borderGeometry = new THREE.BoxGeometry(signWidth + 0.2, signHeight + 0.2, 0.1);
        const borderMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x8B7355,
            roughness: 0.6
        });
        const border = new THREE.Mesh(borderGeometry, borderMaterial);
        border.position.set(x, y, z + 0.15);
        buildingGroup.add(border);
        
        // 使用簡化的文字表示（實際應使用字體檔案）
        const textMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xFFFFFF,
            roughness: 0.2,
            emissive: 0xFFFFFF,
            emissiveIntensity: 0.1
        });
        
        const textGroup = new THREE.Group();
        const charWidth = 0.9;
        const charSpacing = 0.15;
        
        for (let i = 0; i < text.length; i++) {
            const charGeometry = new THREE.BoxGeometry(charWidth, 1.2, 0.15);
            const charMesh = new THREE.Mesh(charGeometry, textMaterial);
            charMesh.position.set(
                x - (text.length * (charWidth + charSpacing)) / 2 + i * (charWidth + charSpacing) + charWidth / 2,
                y,
                z + 0.25
            );
            textGroup.add(charMesh);
        }
        
        buildingGroup.add(textGroup);
    }
    
    createObservatory(buildingGroup, x, y, z) {
        // 天信天文台 - 圓頂觀測台
        const observatoryGroup = new THREE.Group();
        
        // 圓頂
        const domeGeometry = new THREE.SphereGeometry(3, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
        const domeMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x2F4F4F,
            roughness: 0.4,
            metalness: 0.6
        });
        const dome = new THREE.Mesh(domeGeometry, domeMaterial);
        dome.position.set(x, y + 2, z);
        dome.castShadow = true;
        observatoryGroup.add(dome);
        
        // 觀測窗口
        const windowGeometry = new THREE.BoxGeometry(1.5, 1, 0.3);
        const windowMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x87CEEB,
            transparent: true,
            opacity: 0.6
        });
        const observatoryWindow = new THREE.Mesh(windowGeometry, windowMaterial);
        observatoryWindow.position.set(x, y + 3, z + 2.5);
        observatoryGroup.add(observatoryWindow);
        
        // 基座
        const baseGeometry = new THREE.CylinderGeometry(3.5, 4, 2, 16);
        const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 });
        const base = new THREE.Mesh(baseGeometry, baseMaterial);
        base.position.set(x, y + 1, z);
        base.castShadow = true;
        observatoryGroup.add(base);
        
        buildingGroup.add(observatoryGroup);
    }
    
    addDetailedDoor(buildingGroup, x, y, z, width = 3, height = 5) {
        // 添加精細的門 - 升級版
        const doorMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x4A3728,
            roughness: 0.7
        });
        
        const frameMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x2F4F4F,
            roughness: 0.5
        });
        
        const glassMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x87CEEB,
            transparent: true,
            opacity: 0.4,
            roughness: 0.1,
            metalness: 0.8
        });
        
        // 門框 - 更精細的設計
        const frameGeometry = new THREE.BoxGeometry(width + 0.4, height + 0.4, 0.2);
        const frame = new THREE.Mesh(frameGeometry, frameMaterial);
        frame.position.set(x, y, z);
        frame.castShadow = true;
        buildingGroup.add(frame);
        
        // 門框裝飾線條
        const trimGeometry = new THREE.BoxGeometry(width + 0.5, 0.1, 0.25);
        const trimTop = new THREE.Mesh(trimGeometry, frameMaterial);
        trimTop.position.set(x, y + height/2 + 0.2, z);
        buildingGroup.add(trimTop);
        
        const trimBottom = new THREE.Mesh(trimGeometry, frameMaterial);
        trimBottom.position.set(x, y - height/2 - 0.2, z);
        buildingGroup.add(trimBottom);
        
        // 主門 - 雙扇門設計
        const doorGeometry = new THREE.BoxGeometry(width / 2 - 0.1, height - 0.2, 0.1);
        const door1 = new THREE.Mesh(doorGeometry, doorMaterial);
        door1.position.set(x - width / 4, y, z + 0.1);
        door1.castShadow = true;
        buildingGroup.add(door1);
        
        const door2 = new THREE.Mesh(doorGeometry, doorMaterial);
        door2.position.set(x + width / 4, y, z + 0.1);
        door2.castShadow = true;
        buildingGroup.add(door2);
        
        // 門上的玻璃窗
        const doorWindowGeometry = new THREE.PlaneGeometry(width / 2 - 0.3, height / 2);
        const doorWindow1 = new THREE.Mesh(doorWindowGeometry, glassMaterial);
        doorWindow1.position.set(x - width / 4, y + height/4, z + 0.15);
        buildingGroup.add(doorWindow1);
        
        const doorWindow2 = new THREE.Mesh(doorWindowGeometry, glassMaterial);
        doorWindow2.position.set(x + width / 4, y + height/4, z + 0.15);
        buildingGroup.add(doorWindow2);
        
        // 門把手 - 更精細的設計
        const handleGeometry = new THREE.SphereGeometry(0.08, 16, 16);
        const handleMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xFFD700,
            roughness: 0.3,
            metalness: 0.8
        });
        
        const handle1 = new THREE.Mesh(handleGeometry, handleMaterial);
        handle1.position.set(x - width / 4 + 0.3, y, z + 0.2);
        buildingGroup.add(handle1);
        
        const handle2 = new THREE.Mesh(handleGeometry, handleMaterial);
        handle2.position.set(x + width / 4 - 0.3, y, z + 0.2);
        buildingGroup.add(handle2);
        
        // 門檻
        const thresholdGeometry = new THREE.BoxGeometry(width + 0.2, 0.1, 0.3);
        const thresholdMaterial = new THREE.MeshStandardMaterial({ color: 0x3A3A3A });
        const threshold = new THREE.Mesh(thresholdGeometry, thresholdMaterial);
        threshold.position.set(x, y - height/2 - 0.25, z);
        buildingGroup.add(threshold);
    }
    
    // 新增：程序化建築細節生成
    addArchitecturalDetails(buildingGroup, width, height, depth, x, y, z) {
        // 添加建築細節：裝飾線條、角落石、屋簷、紋理等
        const detailMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xD3D3D3,
            roughness: 0.6
        });
        
        const accentMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xA9A9A9,
            roughness: 0.4
        });
        
        // 屋簷裝飾 - 多層次設計
        const corniceGeometry = new THREE.BoxGeometry(width + 0.5, 0.3, depth + 0.5);
        const cornice = new THREE.Mesh(corniceGeometry, detailMaterial);
        cornice.position.set(x, y + height/2 + 0.15, z);
        cornice.castShadow = true;
        buildingGroup.add(cornice);
        
        // 屋簷第二層
        const cornice2Geometry = new THREE.BoxGeometry(width + 0.3, 0.2, depth + 0.3);
        const cornice2 = new THREE.Mesh(cornice2Geometry, accentMaterial);
        cornice2.position.set(x, y + height/2 + 0.45, z);
        cornice2.castShadow = true;
        buildingGroup.add(cornice2);
        
        // 角落石 - 更精細的設計
        const cornerStoneGeometry = new THREE.BoxGeometry(0.8, 1.5, 0.8);
        const cornerPositions = [
            [x - width/2, y - height/2 + 0.75, z - depth/2],
            [x + width/2, y - height/2 + 0.75, z - depth/2],
            [x - width/2, y - height/2 + 0.75, z + depth/2],
            [x + width/2, y - height/2 + 0.75, z + depth/2]
        ];
        
        cornerPositions.forEach(pos => {
            const cornerStone = new THREE.Mesh(cornerStoneGeometry, detailMaterial);
            cornerStone.position.set(pos[0], pos[1], pos[2]);
            cornerStone.castShadow = true;
            buildingGroup.add(cornerStone);
            
            // 角落石裝飾
            const cornerAccentGeometry = new THREE.BoxGeometry(0.4, 0.3, 0.4);
            const cornerAccent = new THREE.Mesh(cornerAccentGeometry, accentMaterial);
            cornerAccent.position.set(pos[0], y - height/2 + 1.5, pos[2]);
            buildingGroup.add(cornerAccent);
        });
        
        // 垂直裝飾線條 - 增加數量
        for (let i = 0; i < 6; i++) {
            const pillarX = x - width/2 + (width / 5) * i;
            const pillarGeometry = new THREE.BoxGeometry(0.15, height, 0.15);
            const pillar = new THREE.Mesh(pillarGeometry, detailMaterial);
            pillar.position.set(pillarX, y, z + depth/2 + 0.1);
            pillar.castShadow = true;
            buildingGroup.add(pillar);
            
            // 對側垂直線條
            const pillar2 = new THREE.Mesh(pillarGeometry, detailMaterial);
            pillar2.position.set(pillarX, y, z - depth/2 - 0.1);
            pillar2.castShadow = true;
            buildingGroup.add(pillar2);
        }
        
        // 水平裝飾線條
        for (let i = 1; i < 4; i++) {
            const trimY = y - height/2 + (height / 4) * i;
            const trimGeometry = new THREE.BoxGeometry(width + 0.3, 0.15, 0.2);
            const trim = new THREE.Mesh(trimGeometry, accentMaterial);
            trim.position.set(x, trimY, z + depth/2 + 0.1);
            buildingGroup.add(trim);
            
            const trim2 = new THREE.Mesh(trimGeometry, accentMaterial);
            trim2.position.set(x, trimY, z - depth/2 - 0.1);
            buildingGroup.add(trim2);
        }
        
        // 添加窗台
        this.addWindowSills(buildingGroup, width, height, depth, x, y, z);
    }
    
    // 新增：窗台細節
    addWindowSills(buildingGroup, width, height, depth, x, y, z) {
        const sillMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x8B7355,
            roughness: 0.7
        });
        
        const sillGeometry = new THREE.BoxGeometry(2, 0.1, 0.3);
        const windowSpacingX = 3.5;
        const windowSpacingY = 3.5;
        
        // 前面窗台
        for (let i = 0; i < Math.floor((width - 2) / windowSpacingX); i++) {
            for (let j = 0; j < Math.floor((height - 2) / windowSpacingY); j++) {
                const sillX = x - width/2 + windowSpacingX/2 + i * windowSpacingX;
                const sillY = y - height/2 + windowSpacingY/2 + j * windowSpacingY;
                
                const sill = new THREE.Mesh(sillGeometry, sillMaterial);
                sill.position.set(sillX, sillY - 1.2, z + depth/2 + 0.2);
                sill.castShadow = true;
                buildingGroup.add(sill);
            }
        }
    }
    
    // 新增：複雜屋頂生成
    createDetailedRoof(buildingGroup, width, depth, x, y, z, roofType = 'flat') {
        const roofMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x8B7355,
            roughness: 0.7
        });
        
        if (roofType === 'flat') {
            // 平屋頂
            const roofGeometry = new THREE.BoxGeometry(width + 1, 0.5, depth + 1);
            const roof = new THREE.Mesh(roofGeometry, roofMaterial);
            roof.position.set(x, y, z);
            roof.castShadow = true;
            buildingGroup.add(roof);
            
            // 屋頂防水層
            const waterproofGeometry = new THREE.BoxGeometry(width + 0.8, 0.1, depth + 0.8);
            const waterproofMaterial = new THREE.MeshStandardMaterial({ color: 0x2F2F2F });
            const waterproof = new THREE.Mesh(waterproofGeometry, waterproofMaterial);
            waterproof.position.set(x, y + 0.3, z);
            buildingGroup.add(waterproof);
            
        } else if (roofType === 'gabled') {
            // 山形屋頂
            const roofHeight = 3;
            const roofShape = new THREE.Shape();
            roofShape.moveTo(-width/2, 0);
            roofShape.lineTo(0, roofHeight);
            roofShape.lineTo(width/2, 0);
            roofShape.lineTo(-width/2, 0);
            
            const extrudeSettings = {
                steps: 1,
                depth: depth + 1,
                bevelEnabled: false
            };
            
            const roofGeometry = new THREE.ExtrudeGeometry(roofShape, extrudeSettings);
            const roof = new THREE.Mesh(roofGeometry, roofMaterial);
            roof.position.set(x, y, z - depth/2 - 0.5);
            roof.castShadow = true;
            buildingGroup.add(roof);
        }
        
        // 屋頂排水溝
        const gutterGeometry = new THREE.BoxGeometry(width + 1.2, 0.15, 0.3);
        const gutterMaterial = new THREE.MeshStandardMaterial({ color: 0x404040 });
        const gutterFront = new THREE.Mesh(gutterGeometry, gutterMaterial);
        gutterFront.position.set(x, y - 0.2, z + depth/2 + 0.5);
        buildingGroup.add(gutterFront);
        
        const gutterBack = new THREE.Mesh(gutterGeometry, gutterMaterial);
        gutterBack.position.set(x, y - 0.2, z - depth/2 - 0.5);
        buildingGroup.add(gutterBack);
    }
    
    addBalcony(buildingGroup, x, y, z, width = 8, depth = 3) {
        // 添加陽台
        const balconyMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x8B7355,
            roughness: 0.7
        });
        
        const railingMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x2F4F4F,
            roughness: 0.5
        });
        
        // 陽台地板
        const floorGeometry = new THREE.BoxGeometry(width, 0.2, depth);
        const floor = new THREE.Mesh(floorGeometry, balconyMaterial);
        floor.position.set(x, y, z);
        floor.castShadow = true;
        buildingGroup.add(floor);
        
        // 欄杆
        const railingGeometry = new THREE.BoxGeometry(width, 1, 0.1);
        const railing = new THREE.Mesh(railingGeometry, railingMaterial);
        railing.position.set(x, y + 0.6, z + depth / 2);
        railing.castShadow = true;
        buildingGroup.add(railing);
        
        // 欄杆柱子
        for (let i = 0; i <= width / 1.5; i++) {
            const pillarGeometry = new THREE.BoxGeometry(0.1, 1, 0.1);
            const pillar = new THREE.Mesh(pillarGeometry, railingMaterial);
            pillar.position.set(x - width / 2 + i * 1.5, y + 0.5, z + depth / 2);
            pillar.castShadow = true;
            buildingGroup.add(pillar);
        }
    }
    
    setupControls() {
        this.controls.keys = {};
        this.controls.cameraAngle = 0;
        this.controls.cameraPitch = 0.3;
        this.playerRadius = 0.45;
        this.speedMultiplier = 1;
        if (this.isMobile) this.setupTouchControls();
    }
    
    detectMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
               (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)) ||
               window.innerWidth <= 767;
    }
    
    // 為建築計算碰撞盒；這些名稱是「實心」建築，走不進去
    prepareBuildings() {
        for (const b of this.buildings) {
            b.box = new THREE.Box3().setFromObject(b.mesh);
            b.solid = !!b.footprint && !b.customCollision;
            if (b.solid) this.solids.push(b);
        }
    }
    
    resolveCollisions(pos, enforceCampusBoundary = !this.wantedLevel && !this.isExploringOutsideCampus) {
        const r = this.playerRadius;
        this.resolveHallCollisions(pos);
        for (let pass = 0; pass < 2; pass++) {
            for (const b of this.solids) {
                if (!b.footprint) continue;
                // 騎樓／挑空走道：可直接穿過一樓
                if (b.walkway && pos.x >= b.walkway.minX && pos.x <= b.walkway.maxX &&
                    pos.z >= b.walkway.minZ && pos.z <= b.walkway.maxZ) {
                    // 挑空走道：在樓裡面時被兩側牆夾住，不會被推出樓外
                    if (b.tunnel && pos.z > b.tunnel.zmin + 0.4 && pos.z < b.tunnel.zmax - 0.4) {
                        pos.x = Math.max(b.walkway.minX + r, Math.min(b.walkway.maxX - r, pos.x));
                    }
                    continue;
                }
                const inside = this.isPointInPolygon(pos.x, pos.z, b.footprint);
                const c = this.closestPointOnPolygon(pos.x, pos.z, b.footprint);
                const dx = pos.x - c.x, dz = pos.z - c.z;
                const d = Math.hypot(dx, dz);
                if (inside) {
                    // 在樓裡面：從最近的牆面推出去
                    const len = d || 1;
                    pos.x = c.x - dx / len * (r + 0.05);
                    pos.z = c.z - dz / len * (r + 0.05);
                } else if (d < r) {
                    pos.x = c.x + dx / d * (r + 0.02);
                    pos.z = c.z + dz / d * (r + 0.02);
                }
            }
        }
        for (const c of this.columns) {
            const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz);
            if (d < c.r + r) { const k = (c.r + r + 0.02) / (d || 1); pos.x = c.x + dx * k; pos.z = c.z + dz * k; }
        }
        for (const barrier of this.wantedRoadblockColliders) {
            const dx = pos.x - barrier.x, dz = pos.z - barrier.z;
            const cos = Math.cos(barrier.rotation), sin = Math.sin(barrier.rotation);
            let localX = dx * cos - dz * sin;
            let localZ = dx * sin + dz * cos;
            const closestX = Math.max(-barrier.halfLength, Math.min(barrier.halfLength, localX));
            const closestZ = Math.max(-barrier.halfWidth, Math.min(barrier.halfWidth, localZ));
            const offsetX = localX - closestX, offsetZ = localZ - closestZ;
            const distance = Math.hypot(offsetX, offsetZ);
            if (distance < r) {
                if (distance > 0) {
                    const scale = (r + 0.02) / distance;
                    localX = closestX + offsetX * scale;
                    localZ = closestZ + offsetZ * scale;
                } else if (barrier.halfLength - Math.abs(localX) < barrier.halfWidth - Math.abs(localZ)) {
                    localX = Math.sign(localX || 1) * (barrier.halfLength + r + 0.02);
                } else {
                    localZ = Math.sign(localZ || 1) * (barrier.halfWidth + r + 0.02);
                }
                pos.x = barrier.x + localX * cos + localZ * sin;
                pos.z = barrier.z - localX * sin + localZ * cos;
            }
        }
        if (enforceCampusBoundary && this.campusBoundary && !this.isPointInPolygon(pos.x, pos.z, this.campusBoundary)) {
            const closest = this.closestPointOnPolygon(pos.x, pos.z, this.campusBoundary);
            const centerX = this.campusBoundary.reduce((sum, point) => sum + point.x, 0) / this.campusBoundary.length;
            const centerZ = this.campusBoundary.reduce((sum, point) => sum + point.z, 0) / this.campusBoundary.length;
            const dx = centerX - closest.x, dz = centerZ - closest.z;
            const length = Math.hypot(dx, dz) || 1;
            pos.x = closest.x + dx / length * 0.8;
            pos.z = closest.z + dz / length * 0.8;
        }
    }

    isPointInPolygon(x, z, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const a = polygon[i], b = polygon[j];
            const crosses = (a.z > z) !== (b.z > z) &&
                x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x;
            if (crosses) inside = !inside;
        }
        return inside;
    }

    closestPointOnPolygon(x, z, polygon) {
        let closest = polygon[0];
        let bestDistance = Infinity;
        for (let index = 0; index < polygon.length; index++) {
            const start = polygon[index], end = polygon[(index + 1) % polygon.length];
            const dx = end.x - start.x, dz = end.z - start.z;
            const lengthSquared = dx * dx + dz * dz || 1;
            const ratio = Math.max(0, Math.min(1, ((x - start.x) * dx + (z - start.z) * dz) / lengthSquared));
            const point = { x: start.x + dx * ratio, z: start.z + dz * ratio };
            const distance = (x - point.x) ** 2 + (z - point.z) ** 2;
            if (distance < bestDistance) {
                bestDistance = distance;
                closest = point;
            }
        }
        return closest;
    }
    
    setupTouchControls() {
        document.body.classList.add('is-mobile');
        document.getElementById('mobile-controls').classList.remove('hidden');
        const lookArea = document.createElement('div');
        lookArea.id = 'look-area';
        document.getElementById('game-container').appendChild(lookArea);
        
        const tc = this.touchControls;
        tc.joyId = null;
        tc.lookId = null;
        const base = document.getElementById('joystick-base');
        const stick = document.getElementById('joystick-stick');
        const find = (list, id) => { for (const t of list) if (t.identifier === id) return t; return null; };
        const opt = { passive: false };
        
        const moveStick = (t) => {
            const rect = base.getBoundingClientRect();
            let dx = t.clientX - (rect.left + rect.width / 2);
            let dy = t.clientY - (rect.top + rect.height / 2);
            const max = rect.width / 2 - 25;
            const dist = Math.hypot(dx, dy);
            if (dist > max) { dx = dx / dist * max; dy = dy / dist * max; }
            stick.style.transition = 'none';
            stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            tc.joystickX = dx / max;
            tc.joystickY = dy / max;
        };
        const resetStick = () => {
            tc.joyId = null; tc.joystickActive = false; tc.joystickX = 0; tc.joystickY = 0;
            stick.style.transition = '';
            stick.style.transform = 'translate(-50%, -50%)';
        };
        base.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (tc.joyId !== null) return;
            const t = e.changedTouches[0];
            tc.joyId = t.identifier; tc.joystickActive = true; moveStick(t);
        }, opt);
        base.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const t = find(e.changedTouches, tc.joyId);
            if (t) moveStick(t);
        }, opt);
        const endJoy = (e) => { if (find(e.changedTouches, tc.joyId)) resetStick(); };
        base.addEventListener('touchend', endJoy);
        base.addEventListener('touchcancel', endJoy);
        
        // 視角：用獨立的手指 id，不會和搖桿互相干擾
        lookArea.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (tc.lookId !== null) return;
            const t = e.changedTouches[0];
            tc.lookId = t.identifier; tc.lastTouchX = t.clientX; tc.lastTouchY = t.clientY;
        }, opt);
        lookArea.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const t = find(e.changedTouches, tc.lookId);
            if (!t) return;
            this.rotateCamera(t.clientX - tc.lastTouchX, t.clientY - tc.lastTouchY, 0.005);
            tc.lastTouchX = t.clientX; tc.lastTouchY = t.clientY;
        }, opt);
        const endLook = (e) => { if (find(e.changedTouches, tc.lookId)) tc.lookId = null; };
        lookArea.addEventListener('touchend', endLook);
        lookArea.addEventListener('touchcancel', endLook);
        
        const hold = (id, key) => {
            const el = document.getElementById(id);
            const on = (e) => { e.preventDefault(); this.controls.keys[key] = true; };
            const off = (e) => { e.preventDefault(); this.controls.keys[key] = false; };
            el.addEventListener('touchstart', on, opt);
            el.addEventListener('touchend', off, opt);
            el.addEventListener('touchcancel', off, opt);
        };
        hold('jump-btn', ' ');
        hold('sprint-btn', 'shift');
        document.getElementById('vehicle-btn').addEventListener('click', () => this.interactWithVehicle());
    }
    
    rotateCamera(dx, dy, sens) {
        this.controls.cameraAngle -= dx * sens;
        this.controls.cameraPitch += dy * sens; // 滑鼠往上 = 鏡頭往下壓，往上看
        this.controls.cameraPitch = Math.max(-0.1, Math.min(1.2, this.controls.cameraPitch));
    }
    
    setupEventListeners() {
        document.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) e.preventDefault();
            this.controls.keys[key] = true;
            if (key === 'm' && !e.repeat) this.toggleMinimap();
            if (key === 'e' && !e.repeat && this.gameState === 'playing') this.interactWithVehicle();
            if (key === 'escape' && !e.repeat) {
                if (this.gameState === 'paused' || (this.gameState === 'playing' && !document.pointerLockElement)) {
                    this.toggleMenu();
                }
            }
        });
        document.addEventListener('keyup', (e) => {
            this.controls.keys[e.key.toLowerCase()] = false;
        });
        window.addEventListener('blur', () => { this.controls.keys = {}; }); // 避免切視窗後按鍵卡住
        
        document.addEventListener('mousemove', (e) => {
            if (document.pointerLockElement && this.gameState === 'playing') {
                this.rotateCamera(e.movementX, e.movementY, 0.002);
            }
        });
        
        // 按 Esc 時瀏覽器會先解除滑鼠鎖定 → 這時自動開啟選單
        document.addEventListener('pointerlockchange', () => {
            if (!document.pointerLockElement && this.gameState === 'playing' && !this.isMobile) this.toggleMenu();
        });
        
        document.addEventListener('click', (e) => {
            if (this.isMobile || this.gameState !== 'playing' || document.pointerLockElement) return;
            if (e.target.closest && e.target.closest('#game-menu, #minimap')) return;
            this.lockPointer();
        });
        
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
        
        document.getElementById('resume-btn').addEventListener('click', () => this.toggleMenu());
        document.getElementById('settings-btn').addEventListener('click', () => this.showToast('設定功能開發中'));
        document.getElementById('exit-btn').addEventListener('click', () => location.reload());
    }
    
    lockPointer() {
        if (this.isMobile) return;
        try {
            const r = document.body.requestPointerLock();
            if (r && r.catch) r.catch(() => {});
        } catch (err) { /* 瀏覽器剛解除鎖定時會拒絕，忽略 */ }
    }
    
    toggleMenu() {
        const menu = document.getElementById('game-menu');
        if (menu.classList.contains('hidden')) {
            menu.classList.remove('hidden');
            this.gameState = 'paused';
            this.controls.keys = {};
            if (document.pointerLockElement) document.exitPointerLock();
        } else {
            menu.classList.add('hidden');
            this.gameState = 'playing';
            this.lockPointer();
        }
    }
    
    showToast(text) {
        let el = document.getElementById('toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'toast';
            document.getElementById('game-container').appendChild(el);
        }
        el.textContent = text;
        el.classList.add('show');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => el.classList.remove('show'), 5500);
    }
    
    updatePlayer(delta) {
        if (this.gameState !== 'playing') return;
        delta = Math.min(delta, 0.05);
        const p = this.player, k = this.controls.keys, tc = this.touchControls;
        
        let ix = 0, iz = 0; // ix: 右+ ；iz: 後+
        if (this.isMobile && tc.joystickActive) {
            ix = tc.joystickX; iz = tc.joystickY;
        } else {
            if (k['w'] || k['arrowup']) iz -= 1;
            if (k['s'] || k['arrowdown']) iz += 1;
            if (k['a'] || k['arrowleft']) ix -= 1;
            if (k['d'] || k['arrowright']) ix += 1;
        }
        p.isSprinting = !!k['shift'];
        
        const A = this.controls.cameraAngle, sinA = Math.sin(A), cosA = Math.cos(A);
        const len = Math.hypot(ix, iz);
        this.updatePlayerAnimation(delta, len > 0 && !this.currentVehicle, p.isSprinting);
        if (this.currentVehicle) {
            const vehicle = this.currentVehicle;
            const accelerationMultiplier = k['shift'] ? vehicle.accelerationMultiplier : 1;
            const targetSpeed = len > 0 ? vehicle.speed * accelerationMultiplier : 0;
            const rate = len > 0 ? vehicle.acceleration : vehicle.braking;
            vehicle.currentSpeed += (targetSpeed - vehicle.currentSpeed) * Math.min(1, rate * delta);
            this.currentSpeed = vehicle.currentSpeed * Math.min(1, len);
        } else {
            this.currentSpeed = len > 0 ? (p.isSprinting ? 5.7 : 3.6) * this.speedMultiplier * Math.min(1, len) : 0;
        }
        const speedometer = document.getElementById('speedometer');
        if (speedometer) speedometer.textContent = `${Math.round(this.currentSpeed * 3.6)} km/h`;
        if (len > 0) {
            const m = Math.min(1, len);
            ix = ix / len * m; iz = iz / len * m;
            // 鏡頭前方 = (sinA, cosA)，右方 = (-cosA, sinA)
            const wx = -iz * sinA - ix * cosA;
            const wz = -iz * cosA + ix * sinA;
            const speed = this.currentSpeed * delta;
            // 分段移動：每段最多 0.4 公尺並逐段檢查碰撞，高速時才不會穿過牆壁
            const steps = Math.max(1, Math.ceil(speed / 0.4));
            for (let i = 0; i < steps; i++) {
                const ox = p.position.x, oz = p.position.z;
                p.position.x += wx * speed / steps;
                p.position.z += wz * speed / steps;
                if (this.campusBoundary && this.wantedLevel &&
                    !this.isPointInPolygon(p.position.x, p.position.z, this.campusBoundary)) {
                    this.isExploringOutsideCampus = true;
                } else if (this.campusBoundary && !this.wantedLevel &&
                    this.isPointInPolygon(p.position.x, p.position.z, this.campusBoundary)) {
                    this.isExploringOutsideCampus = false;
                }
                this.resolveCollisions(p.position);
                this.applyWalkRules(p, ox, oz);
                this.checkMinorVehicleViolation();
            }
            let diff = Math.atan2(wx, wz) - p.rotation.y;
            diff = Math.atan2(Math.sin(diff), Math.cos(diff));
            p.rotation.y += diff * Math.min(1, 12 * delta);
        }
        
        if (!this.currentVehicle && k[' '] && !p.isJumping) { p.velocity.y = 12; p.isJumping = true; }
        p.velocity.y -= 45 * delta;
        p.position.y += p.velocity.y * delta;
        const groundY = this.playerGround + this.getGroundY(p.position.x, p.position.z);   // 校史館門檻／台階／坡道／平台
        if (p.position.y <= groundY) { p.position.y = groundY; p.velocity.y = 0; p.isJumping = false; }
        
        this.resolveCollisions(p.position);
        this.resolveBlockers(p.position, p.position.y - this.playerGround);
        if (this.currentVehicle) {
            this.currentVehicle.mesh.position.set(p.position.x, 0, p.position.z);
            this.currentVehicle.mesh.rotation.y = p.rotation.y;
        }
        this.updatePedestrians(delta);
        this.updateWanted(delta);
        
        // 第三人稱鏡頭（角度、距離固定，不會因為牆而改變）
        const d = 6.5, pitch = this.controls.cameraPitch;
        this.camera.position.set(
            p.position.x - sinA * Math.cos(pitch) * d,
            Math.max(0.5, p.position.y + 0.9 + Math.sin(pitch) * d),
            p.position.z - cosA * Math.cos(pitch) * d
        );
        const head = { x: p.position.x, y: p.position.y + 0.9, z: p.position.z };
        this.climbCameraOverWalls(head, this.camera.position, delta);
        this.fitCameraInHall(head, this.camera.position);
        p.visible = !this.currentVehicle;
        this.camera.lookAt(p.position.x, p.position.y + 0.9, p.position.z);
        
        // 陰影跟著玩家
        if (this.sun) {
            this.sun.position.set(p.position.x + 50, 100, p.position.z + 50);
            this.sun.target.position.copy(p.position);
        }
        
    }
    
    simulateLoading() {
        const loadingScreen = document.getElementById('loading-screen');
        const loadingProgress = document.querySelector('.loading-progress');
        let progress = 0;
        
        const loadingInterval = setInterval(() => {
            progress += Math.random() * 15;
            if (progress >= 100) {
                progress = 100;
                clearInterval(loadingInterval);
                
                setTimeout(() => {
                    loadingScreen.style.opacity = '0';
                    setTimeout(() => {
                        loadingScreen.classList.add('hidden');
                        this.gameState = 'playing';
                        this.isLoading = false;
                        console.log('Game loaded successfully!');
                    }, 500);
                }, 500);
            }
            loadingProgress.style.width = progress + '%';
        }, 200);
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        const delta = this.clock.getDelta();
        
        this.updatePlayer(delta);
        this.updateMinimap();
        
        this.renderer.render(this.scene, this.camera);
    }
}

// 啟動遊戲（由 HTML 中的 initGame() 函數調用）
try {
    console.log('Starting game initialization...');
    new Game();
} catch (error) {
    console.error('Game initialization failed:', error);
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
        loadingScreen.innerHTML = `
            <h1>遊戲載入失敗</h1>
            <p>錯誤: ${error.message}</p>
            <button onclick="location.reload()" style="padding: 10px 20px; margin-top: 20px; cursor: pointer;">重新載入</button>
        `;
    }
}