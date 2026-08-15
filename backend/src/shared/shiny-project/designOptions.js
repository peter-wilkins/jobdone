export const shinyDesignOptions = Object.freeze({
  productTypes: [
    { value: 'embossed_metal_picture', label: 'Embossed metal picture', available: true, stockLevel: 1000000 },
    { value: 'layered_card_artwork', label: '3D layered card picture', available: true, stockLevel: 1000000 },
  ],
  materials: [
    { value: 'aluminium', label: 'Aluminium', available: true, stockLevel: 1000000 },
    { value: 'copper_effect', label: 'Copper effect', available: true, stockLevel: 1000000 },
    { value: 'brass_effect', label: 'Brass effect', available: true, stockLevel: 1000000 },
    { value: 'brushed_steel_effect', label: 'Brushed steel effect', available: true, stockLevel: 1000000 },
    { value: 'white_card', label: 'White card', available: true, stockLevel: 1000000 },
    { value: 'black_core_card', label: 'Black core card', available: true, stockLevel: 1000000 },
    { value: 'coloured_core_card', label: 'Coloured core card', available: true, stockLevel: 1000000 },
    { value: 'kraft_card', label: 'Kraft card', available: true, stockLevel: 1000000 },
  ],
  finishes: [
    { value: 'natural', label: 'Natural', available: true, stockLevel: 1000000 },
    { value: 'framed', label: 'Framed', available: true, stockLevel: 1000000 },
  ],
});

export function sellableShinyDesignOptions(options = shinyDesignOptions) {
  return {
    productTypes: (options.productTypes || []).filter(option => option.available),
    materials: (options.materials || []).filter(option => option.available),
    finishes: (options.finishes || []).filter(option => option.available),
  };
}

export function isSellableDesignDirection(direction, options = shinyDesignOptions) {
  const sellable = sellableShinyDesignOptions(options);
  return sellable.productTypes.some(option => option.value === direction.productType) &&
    sellable.materials.some(option => option.value === direction.material) &&
    sellable.finishes.some(option => option.value === direction.finish);
}
