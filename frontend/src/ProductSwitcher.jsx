const PRODUCTS = [
  { id: 'jobdone', label: 'JobDone', screen: 'home' },
  { id: 'choremore', label: 'Choremore', screen: 'choremore-parent' },
];

export function ProductSwitcher({ currentProduct, onSwitch }) {
  return (
    <div className="mt-2 inline-flex rounded border border-gray-200 bg-gray-50 p-0.5" aria-label="Product switcher">
      {PRODUCTS.map(product => {
        const active = product.id === currentProduct;
        return (
          <button
            key={product.id}
            type="button"
            onClick={() => {
              if (!active) onSwitch(product.screen);
            }}
            aria-pressed={active}
            className={`px-2.5 py-1 text-xs font-medium rounded ${
              active
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {product.label}
          </button>
        );
      })}
    </div>
  );
}
