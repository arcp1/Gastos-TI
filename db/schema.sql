-- Esquema del sistema de control de gastos de TI
-- Se ejecuta en cada arranque; todo es idempotente.

CREATE TABLE IF NOT EXISTS categorias (
  id        serial PRIMARY KEY,
  nombre    text NOT NULL UNIQUE,
  activa    boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS proveedores (
  id        serial PRIMARY KEY,
  nombre    text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS gastos (
  id             serial PRIMARY KEY,
  fecha          date NOT NULL,
  concepto       text NOT NULL,
  proveedor_id   integer REFERENCES proveedores(id),
  categoria_id   integer NOT NULL REFERENCES categorias(id),
  subtotal       numeric(14,2) NOT NULL DEFAULT 0,
  iva            numeric(14,2) NOT NULL DEFAULT 0,
  total          numeric(14,2) NOT NULL DEFAULT 0,
  estado         text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagado')),
  centro_costo   text,
  notas          text,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gastos_fecha_idx ON gastos (fecha);
CREATE INDEX IF NOT EXISTS gastos_categoria_idx ON gastos (categoria_id);

CREATE TABLE IF NOT EXISTS presupuestos (
  anio          integer NOT NULL,
  categoria_id  integer NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  monto         numeric(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (anio, categoria_id)
);

-- Expediente del gasto: el flujo burocrático cotización -> orden de compra -> factura -> albarán.
CREATE TABLE IF NOT EXISTS documentos (
  id               serial PRIMARY KEY,
  gasto_id         integer NOT NULL REFERENCES gastos(id) ON DELETE CASCADE,
  tipo             text NOT NULL CHECK (tipo IN ('cotizacion','orden_compra','factura','albaran')),
  folio            text,
  fecha            date,
  archivo          text NOT NULL,          -- ruta relativa dentro de la carpeta de uploads
  nombre_original  text,
  tamano           integer,
  subido_en        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documentos_gasto_idx ON documentos (gasto_id);

-- Bitácora: alimenta la línea de tiempo.
CREATE TABLE IF NOT EXISTS eventos (
  id           serial PRIMARY KEY,
  gasto_id     integer REFERENCES gastos(id) ON DELETE CASCADE,
  tipo         text NOT NULL,            -- gasto_creado, gasto_editado, gasto_pagado, documento_subido, documento_borrado
  descripcion  text NOT NULL,
  fecha        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eventos_fecha_idx ON eventos (fecha);

-- Campos agregados después de la primera versión (idempotentes)
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS rfc text;
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS uuid text;
-- Tipo de compra: por proveedor (cotización → OC → factura → albarán) o en línea (pedido → factura → entrega)
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS tipo_compra text NOT NULL DEFAULT 'proveedor';
ALTER TABLE gastos DROP CONSTRAINT IF EXISTS gastos_tipo_compra_check;
ALTER TABLE gastos ADD CONSTRAINT gastos_tipo_compra_check CHECK (tipo_compra IN ('proveedor','linea'));
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS referencia text;   -- número de pedido u otra referencia
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS cantidad numeric(12,2) NOT NULL DEFAULT 1;   -- piezas / unidades compradas
-- Documentos: comprobante de pago (opcional) y confirmación de pedido (compras en línea)
ALTER TABLE documentos DROP CONSTRAINT IF EXISTS documentos_tipo_check;
ALTER TABLE documentos ADD CONSTRAINT documentos_tipo_check CHECK (tipo IN ('cotizacion','orden_compra','factura','albaran','pago','pedido'));

-- Categorías iniciales (solo si la tabla está vacía)
INSERT INTO categorias (nombre)
SELECT v FROM (VALUES
  ('Arrendamiento de equipo'), ('Telefonía y líneas'), ('Internet y enlaces'), ('Licencias y software'),
  ('Hardware y refacciones'), ('Mantenimiento del site'), ('Servicios profesionales'), ('Otros')
) AS t(v)
WHERE NOT EXISTS (SELECT 1 FROM categorias);

-- Vista con todo lo que la interfaz necesita por gasto, incluido el avance del expediente.
DROP VIEW IF EXISTS v_gastos;
CREATE VIEW v_gastos AS
SELECT g.id, g.fecha, g.concepto, g.subtotal, g.iva, g.total, g.estado, g.centro_costo, g.notas,
       g.creado_en, g.actualizado_en,
       g.categoria_id, c.nombre AS categoria,
       g.proveedor_id, p.nombre AS proveedor,
       g.tipo_compra, g.referencia, g.cantidad,
       EXISTS (SELECT 1 FROM documentos d WHERE d.gasto_id = g.id AND d.tipo = 'cotizacion')   AS tiene_cotizacion,
       EXISTS (SELECT 1 FROM documentos d WHERE d.gasto_id = g.id AND d.tipo = 'orden_compra') AS tiene_orden_compra,
       EXISTS (SELECT 1 FROM documentos d WHERE d.gasto_id = g.id AND d.tipo = 'factura')      AS tiene_factura,
       EXISTS (SELECT 1 FROM documentos d WHERE d.gasto_id = g.id AND d.tipo = 'albaran')      AS tiene_albaran,
       EXISTS (SELECT 1 FROM documentos d WHERE d.gasto_id = g.id AND d.tipo = 'pago')         AS tiene_pago,
       EXISTS (SELECT 1 FROM documentos d WHERE d.gasto_id = g.id AND d.tipo = 'pedido')       AS tiene_pedido,
       (SELECT count(*) FROM documentos d WHERE d.gasto_id = g.id)::int AS num_documentos,
       CASE WHEN g.tipo_compra = 'linea'
            THEN (SELECT count(DISTINCT d.tipo) FROM documentos d WHERE d.gasto_id = g.id AND d.tipo IN ('pedido','factura','albaran'))
            ELSE (SELECT count(DISTINCT d.tipo) FROM documentos d WHERE d.gasto_id = g.id AND d.tipo IN ('cotizacion','orden_compra','factura','albaran'))
       END::int AS etapas,
       CASE WHEN g.tipo_compra = 'linea' THEN 3 ELSE 4 END AS etapas_total,
       CASE WHEN g.tipo_compra = 'linea'
            THEN EXISTS (SELECT 1 FROM documentos d WHERE d.gasto_id = g.id AND d.tipo = 'pedido') AND EXISTS (SELECT 1 FROM documentos d WHERE d.gasto_id = g.id AND d.tipo = 'factura') AND EXISTS (SELECT 1 FROM documentos d WHERE d.gasto_id = g.id AND d.tipo = 'albaran')
            ELSE EXISTS (SELECT 1 FROM documentos d WHERE d.gasto_id = g.id AND d.tipo = 'cotizacion') AND EXISTS (SELECT 1 FROM documentos d WHERE d.gasto_id = g.id AND d.tipo = 'orden_compra') AND EXISTS (SELECT 1 FROM documentos d WHERE d.gasto_id = g.id AND d.tipo = 'factura') AND EXISTS (SELECT 1 FROM documentos d WHERE d.gasto_id = g.id AND d.tipo = 'albaran')
       END AS expediente_completo
FROM gastos g
JOIN categorias c ON c.id = g.categoria_id
LEFT JOIN proveedores p ON p.id = g.proveedor_id;
