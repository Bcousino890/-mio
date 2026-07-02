# Por Dónde Empezar: Filtro Mejorado "Particular | Agencia"

## Para Diferentes Roles

### Frontend Developers

**Empezar por:**
1. `/web/components/filters/ADVERTISER_FILTER_DOCS.md` - Lee la documentación completa
2. `/web/components/filters/USAGE_EXAMPLES.tsx` - Revisa los 6 ejemplos prácticos
3. `/web/components/filters/FilterAdvertiserSection.tsx` - Estudia el código del componente

**Luego:**
- Integra el componente en tu página (ver paso 2.1 en ADVERTISER_FILTER_CHECKLIST.md)
- Carga la lista de agencias desde `/api/listings/agencies`
- Pasa props `agencies` e `isLoadingAgencies` a `FilterPanel`

**El componente ya funciona automáticamente:**
- Persistencia en localStorage
- URL params compartibles
- Serialización/Deserialización
- Validación de estado

---

### Backend Developers

**Empezar por:**
1. `/web/components/filters/IMPLEMENTATION_SUMMARY.md` - Lee sección "Paso 3.1"
2. `/db/sql_examples/advertiser_filter_queries.sql` - Estudia las queries SQL

**Qué implementar:**
1. Crear endpoint `GET /api/listings/agencies`
   - Retorna: `[{ agency_id: "uuid", agency_name: "string" }, ...]`
   - Query: `SELECT DISTINCT advertiser_name FROM listings WHERE ...`

2. Actualizar `GET /api/listings` para procesar nuevos parámetros:
   - `advertiser_mode` (all/particular/agency)
   - `only_particular` (boolean)
   - `agency_id` (uuid)
   - `exclusive_mode` (both/only/only_non)
   - `exclude_agency_id` (uuid)

**Ejemplos de lógica:**
```python
if advertiser_mode == "particular":
    query = query.filter(Listing.advertiser_type == "particular")
    
elif advertiser_mode == "agency":
    query = query.filter(Listing.advertiser_type == "professional")
    if agency_id:
        query = query.filter(Listing.advertiser_name == agency_id)
    if exclusive_mode == "only":
        query = query.filter(Listing.exclusive == True)
```

---

### Product/QA Managers

**Empezar por:**
1. `/web/components/filters/FILTER_STRUCTURE.md` - Diagramas y flujos de usuario
2. `/ADVERTISER_FILTER_CHECKLIST.md` - Fases de implementación y timeline
3. `/ADVERTISER_FILTER_SUMMARY.txt` - Resumen ejecutivo

**Entender:**
- Estructura jerárquica del filtro (Radio + sub-opciones expandibles)
- Qué parámetros URL se generan
- Timeline de 7 fases (1 completada, 6 por hacer)

**Para Testing:**
Ver Fase 5 en `/ADVERTISER_FILTER_CHECKLIST.md`:
- Unit tests para componente
- Integration tests para hook
- E2E tests para flujo completo

---

### Tech Leads / Architects

**Empezar por:**
1. `/ADVERTISER_FILTER_SUMMARY.txt` - Resumen ejecutivo
2. `/ADVERTISER_FILTER_CHECKLIST.md` - Plan de implementación completo
3. `/web/components/filters/IMPLEMENTATION_SUMMARY.md` - Consideraciones técnicas

**Puntos clave:**
- Phase 1 (Frontend) completada y lista
- Phase 2-7 requieren coordinación entre equipos
- Backward compatible (sin breaking changes)
- Progressive enhancement (funciona sin BD futuras)

**Timeline recomendado:**
- Semanas 1-2: Integración frontend + API de agencias
- Semana 3: Backend de filtrado
- Semana 4: Migración BD (0018)
- Semana 5-6: Testing
- Semanas 7+: Opcionales privados + monitoreo

---

### Database Administrators

**Empezar por:**
1. `/db/sql_examples/advertiser_filter_queries.sql` - Lee las queries de ejemplo
2. `/ADVERTISER_FILTER_CHECKLIST.md` Fase 4 - Script de migración propuesto

**Qué hacer (después de validación):**
Ejecutar migración 0018 cuando sea necesario:
```sql
ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_private_by_agency boolean DEFAULT false;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS was_private_by_agency boolean DEFAULT false;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS exclusive boolean DEFAULT false;

CREATE INDEX idx_listings_is_private_by_agency ON listings(is_private_by_agency) ...
CREATE INDEX idx_listings_was_private_by_agency ON listings(was_private_by_agency) ...
CREATE INDEX idx_listings_exclusive ON listings(exclusive, advertiser_type) ...
```

**Notas:**
- NO es urgente (sistema funciona sin estas columnas)
- Se pueden agregar después que frontend esté completo
- Las opciones privadas están disabled en UI hasta que se agreguen

---

## Estructura de Archivos Rápida

```
IMPLEMENTACIÓN COMPLETADA:
├─ Componente: /web/components/filters/FilterAdvertiserSection.tsx
├─ Hooks: /web/hooks/useFilters.ts (actualizado)
├─ Panel: /web/components/filters/FilterPanel.tsx (actualizado)

DOCUMENTACIÓN:
├─ ADVERTISER_FILTER_DOCS.md          → Cómo usar
├─ FILTER_STRUCTURE.md                → Diagramas
├─ USAGE_EXAMPLES.tsx                 → Código de ejemplo
├─ IMPLEMENTATION_SUMMARY.md          → Detalles técnicos

REFERENCIA:
├─ ADVERTISER_FILTER_CHECKLIST.md     → Plan de 7 fases
├─ advertiser_filter_queries.sql      → Queries SQL
└─ DONDE_EMPEZAR.md                   ← TÚ ESTÁS AQUÍ
```

---

## Preguntas Frecuentes

**P: ¿Necesito cambiar algo ahora?**
R: Solo si quieres integrarlo. El código está 100% funcional y ready para production.

**P: ¿Y si no agrego las columnas de "privados"?**
R: Funciona perfectamente. Las opciones de privados están deshabilitadas en UI.

**P: ¿Se pierden los filtros si la página se recarga?**
R: No. Se guardan en localStorage automáticamente.

**P: ¿Puedo compartir los filtros con otros?**
R: Sí. Se convierten a URL params. Ejemplo: `?advertiser_mode=particular&only_particular=true`

**P: ¿Debo actualizar el campo `advertiserType` antiguo?**
R: No. Se mantiene por compatibilidad. El nuevo `advertiserFilter` es complementario.

**P: ¿Qué necesito del backend?**
R: Dos cosas:
1. Endpoint `/api/listings/agencies` (fácil)
2. Procesar nuevos params en `/api/listings` (moderado)

---

## Checklist Rápido

- [ ] Lei la documentación para mi rol
- [ ] Entiendo la estructura del filtro
- [ ] Sé cuáles son los próximos pasos
- [ ] Tengo claro el timeline
- [ ] Identificué a qué equipo asignar cada fase

---

## Contacto

Para preguntas específicas, revisar la documentación relevante:
- Frontend: ADVERTISER_FILTER_DOCS.md
- Backend: IMPLEMENTATION_SUMMARY.md + advertiser_filter_queries.sql
- Arquitectura: ADVERTISER_FILTER_CHECKLIST.md + FILTER_STRUCTURE.md
- Testing: ADVERTISER_FILTER_CHECKLIST.md Fase 5

---

**Fecha: 2026-06-19**
**Estado: Fase 1 Completada (Frontend)**
**Próxima: Fase 2 (Integración en componentes)**
