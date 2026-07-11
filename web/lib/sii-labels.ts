// Diccionarios de códigos SII compartidos entre el visor de catastro y el
// informe imprimible del predio.

export const DESTINO_LABELS: Record<string, string> = {
  H: 'Habitacional', C: 'Comercio', O: 'Oficina', I: 'Industria',
  A: 'Agrícola', B: 'Agroindustrial', D: 'Deporte/Recreación',
  E: 'Educación', F: 'Forestal', G: 'Hotel/Motel', L: 'Bodega',
  M: 'Minería', P: 'Administración Pública', Q: 'Culto',
  S: 'Salud', T: 'Transporte', V: 'Otros', W: 'Sitio Eriazo', Z: 'Estacionamiento',
}

// Clases de material según resolución SII (verificado externamente; el código
// "D" y los códigos de condición especial no están documentados públicamente,
// por eso no se incluyen — se muestra el código crudo en esos casos).
export const MATERIAL_LABELS: Record<string, string> = {
  A: 'Acero',
  B: 'Hormigón armado',
  C: 'Albañilería (ladrillo, piedra o bloque de cemento)',
  E: 'Madera',
}

export const CALIDAD_LABELS: Record<string, string> = {
  '1': 'Superior',
  '2': 'Media superior',
  '3': 'Media',
  '4': 'Media inferior',
  '5': 'Inferior',
}
