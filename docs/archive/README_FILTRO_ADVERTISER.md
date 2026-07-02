# Filtro Mejorado "Particular | Agencia"

Implementación completa de un sistema jerárquico de filtrado por tipo de anunciante con soporte para sub-opciones, selectores dinámicos y URLs compartibles.

## Estado: FASE 1 COMPLETADA

Frontend funcional y listo para integrar. Backend y BD pendientes.

## Estructura Rápida

```
⚫ TODO → muestra todos
⭕ PARTICULAR (expandible)
   ├─ Sólo particulares
   ├─ Listado como privado (TODO: BD)
   └─ Ex-Listado como privado (TODO: BD)
⭕ AGENCIAS (expandible)
   ├─ Con esta agencia (selector dinámico)
   ├─ Exclusividad (radio: Ambos/Solo excl/Solo no excl)
   └─ Excluir esta agencia (selector dinámico)
```

## Archivos Clave

### Frontend (NUEVO)
- `web/components/filters/FilterAdvertiserSection.tsx` - Componente principal

### Actualizados
- `web/components/filters/FilterPanel.tsx` - Integración
- `web/hooks/useFilters.ts` - Estado mejorado

### Documentación
- `web/components/filters/ADVERTISER_FILTER_DOCS.md` - Guía completa
- `web/components/filters/FILTER_STRUCTURE.md` - Diagramas visuales
- `web/components/filters/USAGE_EXAMPLES.tsx` - 6 ejemplos
- `web/components/filters/IMPLEMENTATION_SUMMARY.md` - Detalles técnicos

### Checklists
- `ADVERTISER_FILTER_CHECKLIST.md` - Plan de 7 fases
- `DONDE_EMPEZAR.md` - Guía por rol

### Referencias
- `db/sql_examples/advertiser_filter_queries.sql` - Queries SQL

## Empezar

**Frontend Developers:**
```
1. Lee: web/components/filters/ADVERTISER_FILTER_DOCS.md
2. Revisa: web/components/filters/USAGE_EXAMPLES.tsx
3. Integra en tu componente (paso 2.1 en ADVERTISER_FILTER_CHECKLIST.md)
```

**Backend Developers:**
```
1. Lee: web/components/filters/IMPLEMENTATION_SUMMARY.md
2. Estudia: db/sql_examples/advertiser_filter_queries.sql
3. Implementa API (paso 3.1 en ADVERTISER_FILTER_CHECKLIST.md)
```

**Todos:**
```
→ Empieza en DONDE_EMPEZAR.md
```

## Funcionalidades

✓ Jerarquía radio + sub-opciones  
✓ Expansión/colapso automático  
✓ Selectores dinámicos (agencias desde API)  
✓ Persistencia localStorage  
✓ URLs compartibles  
✓ Backward compatible  
✓ Soporte futuro para opciones privadas  

## URLs Generadas

```
?advertiser_mode=all
?advertiser_mode=particular&only_particular=true
?advertiser_mode=agency&agency_id=uuid-123&exclusive_mode=only
?advertiser_mode=agency&exclude_agency_id=uuid-456
```

## Timeline

- **Semanas 1-2:** Integración frontend + API agencias
- **Semana 3:** Backend de filtrado
- **Semana 4:** Migración BD (0018)
- **Semanas 5-6:** Testing
- **Semanas 7+:** Opcionales + monitoreo

Ver `ADVERTISER_FILTER_CHECKLIST.md` para detalles.

## Requisitos Inmediatos

**Frontend:**
- Cargar agencias desde `/api/listings/agencies`
- Pasar `agencies` + `isLoadingAgencies` a FilterPanel

**Backend:**
- Crear endpoint `GET /api/listings/agencies`
- Procesar nuevos parámetros en `GET /api/listings`

**BD:**
- (Opcional) Migración 0018 cuando sea necesario

## Próximo: Fase 2

Integración de componente en página principal y creación de API de agencias.

---

**Fecha:** 2026-06-19  
**Status:** Fase 1 Completada  
**Mantenedor:** Frontend Team
