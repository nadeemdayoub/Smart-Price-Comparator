import React, { useState, useEffect, useRef } from 'react';
import { CanonicalProduct } from '../types';
import { Search, X, Check, Loader2 } from 'lucide-react';
import { cn, formatCurrency } from '../lib/utils';
import { matchesSearch, highlightSearchText } from '../lib/search';

interface ProductPickerProps {
  products: CanonicalProduct[];
  onSelect: (productId: string) => void;
  placeholder?: string;
  className?: string;
}

const ProductPicker: React.FC<ProductPickerProps> = ({ 
  products, 
  onSelect, 
  placeholder = "Search products...",
  className
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredProducts, setFilteredProducts] = useState<CanonicalProduct[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const filtered = products.filter(p => 
      matchesSearch(p.canonicalName, searchTerm) ||
      matchesSearch(p.brand, searchTerm) ||
      matchesSearch(p.category, searchTerm)
    ).slice(0, 10); // Limit results for performance
    setFilteredProducts(filtered);
  }, [searchTerm, products]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={cn("relative", className)} ref={containerRef}>
      <div 
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 cursor-text hover:border-stone-400 transition-all"
      >
        <Search className="w-4 h-4 text-stone-400" />
        <input
          type="text"
          placeholder={placeholder}
          className="bg-transparent border-none outline-none text-sm w-full"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
        />
        {searchTerm && (
          <button onClick={(e) => {
            e.stopPropagation();
            setSearchTerm('');
          }}>
            <X className="w-3 h-3 text-stone-400 hover:text-stone-600" />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-2 w-full bg-white border border-stone-200 rounded-2xl shadow-xl overflow-hidden max-h-64 overflow-y-auto">
          {filteredProducts.length > 0 ? (
            <div className="py-2">
              {filteredProducts.map((product) => (
                <button
                  key={product.id}
                  onClick={() => {
                    onSelect(product.id);
                    setSearchTerm('');
                    setIsOpen(false);
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-stone-50 flex items-center justify-between group transition-colors"
                >
                  <div className="flex-1">
                    <p className="text-sm font-bold text-stone-900 group-hover:text-stone-900 mb-0.5">
                      {highlightSearchText(product.canonicalName, searchTerm)}
                    </p>
                    <div className="text-[10px] text-stone-500 uppercase tracking-widest flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      <span className="font-medium">{highlightSearchText(product.brand || 'No Brand', searchTerm)}</span>
                      {product.costPrice && (
                        <>
                          <span className="text-stone-300">・</span>
                          <span className="text-emerald-600 font-bold">{formatCurrency(product.costPrice)}</span>
                        </>
                      )}
                      {product.color && (
                        <>
                          <span className="text-stone-300">・</span>
                          <span className="px-1 py-0.5 bg-stone-100 rounded text-[9px] font-bold text-stone-500 uppercase">
                            {product.color}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <Check className="w-4 h-4 text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center">
              <p className="text-sm text-stone-400">No products found for "{searchTerm}"</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProductPicker;
