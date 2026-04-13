import * as XLSX from 'xlsx';
import type { Product } from './priceScraper';
import type { Distributor } from './distributorScraper';

export function productsToXlsx(products: Product[]): Uint8Array {
  const rows = products.map((p) => ({
    Nombre: p.name,
    Precio: p.price ? `${p.currency}${p.price}` : '',
    'Precio anterior': p.oldPrice ? `${p.currency}${p.oldPrice}` : '',
    SKU: p.sku,
    Marca: p.brand,
    Categoría: p.category,
    Etiqueta: p.badge,
    Link: p.link,
    Imagen: p.image,
    'Página fuente': p.sourcePage,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);

  // Auto-size columns
  const colWidths = Object.keys(rows[0] || {}).map((key) => {
    const max = Math.max(
      key.length,
      ...rows.map((r) => String((r as Record<string, string>)[key] || '').length),
    );
    return { wch: Math.min(max + 2, 60) };
  });
  ws['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, 'Productos');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

export function distributorsToXlsx(distributors: Distributor[]): Uint8Array {
  const rows = distributors.map((d) => ({
    Nombre: d.name,
    Dirección: d.address,
    Ciudad: d.city,
    Departamento: d.department,
    Teléfono: d.phone,
    Email: d.email,
    'Sitio web': d.website,
    Horario: d.schedule,
    'Tipo de distribuidor': d.tipo || '',
    'Info adicional': d.extra,
    'Página fuente': d.sourcePage,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);

  const colWidths = Object.keys(rows[0] || {}).map((key) => {
    const max = Math.max(
      key.length,
      ...rows.map((r) => String((r as Record<string, string>)[key] || '').length),
    );
    return { wch: Math.min(max + 2, 60) };
  });
  ws['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, 'Distribuidores');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}
