// Um three de mentira para o teste. O jsdom não tem WebGL: o WebGLRenderer de
// verdade lança ao criar o contexto, e o jogo nem monta. Este dublê é o
// `tests/setup/threeStub.js` do RoqueOS (o que o teste do Velha 3D usava lá,
// até 25/09/2026), recortado ao que o Velha 3D toca: cena, câmera, luzes,
// grupo, malha, as duas geometrias de esfera e a de icosaedro, os materiais, a
// linha da vitória e o raycaster.
//
// Três coisas a mais que lá, para o teste ver pelo lado de fora o que antes só
// dava para ver abrindo o componente:
// - o renderer guarda as opções com que nasceu, o pixel ratio, quantos quadros
//   desenhou, a última cena e se foi descartado, e se pendura no próprio
//   canvas. É assim que o teste confere que o modo leve do host chega no código
//   de GPU e que desmontar solta o contexto;
// - material descartado fica marcado, para o teste pegar vazamento;
// - o raycaster acerta a casa que o teste mandar em `Raycaster.mira` (null é
//   clicar no vazio, como era sempre lá). Sem isso o clique no cubo, que é o
//   único jeito de jogar, ficava sem teste.
// Uso: vi.mock('three', async () => (await import('./threeStub.js')).criarThreeFalso())
export function criarThreeFalso() {
  class Vec3 {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x
      this.y = y
      this.z = z
    }
    set(x, y, z) {
      this.x = x
      this.y = y
      this.z = z
      return this
    }
  }
  class Color {
    constructor(hex = 0xffffff) {
      this.hex = hex
    }
  }
  class Object3D {
    constructor() {
      this.children = []
      this.position = new Vec3()
      this.scale = new Vec3(1, 1, 1)
      this.rotation = new Vec3()
      this.visible = true
      this.userData = {}
    }
    add(...filhos) {
      this.children.push(...filhos)
    }
    remove(x) {
      this.children = this.children.filter((c) => c !== x)
    }
  }
  class Mesh extends Object3D {
    constructor(geometry, material) {
      super()
      this.geometry = geometry
      this.material = material
    }
  }
  class Attr {
    constructor(array, itemSize) {
      this.array = array
      this.itemSize = itemSize
    }
  }
  class Geometry {
    constructor() {
      this.attributes = {}
      this.descartado = false
    }
    setAttribute(nome, attr) {
      this.attributes[nome] = attr
      return this
    }
    dispose() {
      this.descartado = true
    }
  }
  class Material {
    constructor(opcoes = {}) {
      Object.assign(this, opcoes)
      this.opacity = opcoes.opacity ?? 1
      this.descartado = false
    }
    dispose() {
      this.descartado = true
    }
  }
  class Camera extends Object3D {
    constructor(fov, aspect) {
      super()
      this.fov = fov
      this.aspect = aspect
    }
    updateProjectionMatrix() {}
    lookAt() {}
  }
  class Raycaster {
    setFromCamera() {}
    intersectObjects(alvos) {
      if (Raycaster.mira == null) return []
      return alvos
        .filter((m) => m.userData.cell === Raycaster.mira)
        .map((object) => ({ object, distance: 1 }))
    }
  }
  Raycaster.mira = null
  class WebGLRenderer {
    constructor(opcoes = {}) {
      this.opcoes = opcoes
      this.pixelRatio = 1
      this.quadros = 0
      this.cena = null
      this.descartado = false
      this.domElement = document.createElement('canvas')
      this.domElement.width = 640
      this.domElement.height = 480
      this.domElement.__renderizador = this
    }
    setPixelRatio(r) {
      this.pixelRatio = r
    }
    setSize() {}
    render(cena) {
      this.quadros++
      this.cena = cena
    }
    dispose() {
      this.descartado = true
    }
  }
  return {
    Scene: Object3D,
    Group: Object3D,
    Mesh,
    Line: Mesh,
    BufferGeometry: Geometry,
    BufferAttribute: Attr,
    SphereGeometry: class extends Geometry {},
    IcosahedronGeometry: class extends Geometry {},
    MeshStandardMaterial: class extends Material {},
    LineBasicMaterial: class extends Material {},
    AmbientLight: class extends Object3D {},
    DirectionalLight: class extends Object3D {},
    PerspectiveCamera: Camera,
    Color,
    Raycaster,
    WebGLRenderer,
  }
}
