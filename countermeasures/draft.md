El diagnóstico es correcto. Voy a explicar exactamente qué pasa y cómo resolverlo.

## Causa raíz

Mirando `dc_switch.py` (que es `SpineLeaf1`), el comportamiento exacto es:

```
Primera vez que h1 → h4 envía un SYN:
  → PacketIn llega al controller ✓
  → dc_switch instala una regla: match(in_port, eth_src=h1_mac, eth_dst=h4_mac) → forward
  → Los SYN siguientes van DIRECTO por esa regla, NUNCA más llegan al controller ✗
```

El flood de hping3 usa siempre la misma MAC src/dst. La primera regla instalada absorbe TODO el flood subsiguiente. El mitigador solo ve 1 PacketIn por flujo, no los miles de paquetes del flood.

La solución: instalar reglas de **MIRROR** de alta prioridad que copien TCP/UDP al controller **además** de forwardear, sin tocar dc_switch.py.---

## Diagnóstico exacto del problema

Los logs lo confirman claramente:

```
PacketIn totales: 2040  (entre ciclos)
SYN=0.0  UDP=0.0  ICMP=1.5 pps
```

Lo que está pasando: cuando `h1` hace el primer SYN a `h4`, ese paquete llega al controller, `dc_switch.py` lo procesa e instala esta regla en el switch leaf:

```
match(in_port=3, eth_src=h1_mac, eth_dst=h4_mac) → output(puerto_spine)
```

A partir del segundo SYN en adelante, el switch los forwardea directamente usando esa regla. **Nunca llegan al controller.** El mitigador solo vio el primer paquete del flood.

---

## La solución: Mirror Rules (prioridad 200)

El v3 instala automáticamente en cada switch, al conectarse, tres reglas de "mirror":

```
Tabla 0, prioridad 200, match TCP  → OUTPUT(CONTROLLER) + OUTPUT(NORMAL)
Tabla 0, prioridad 200, match UDP  → OUTPUT(CONTROLLER) + OUTPUT(NORMAL)  
Tabla 0, prioridad 200, match ICMP → OUTPUT(CONTROLLER) + OUTPUT(NORMAL)
```

La acción `OUTPUT(NORMAL)` hace que el paquete siga su camino normal por el switch (respetando las reglas de forwarding de dc_switch). La acción `OUTPUT(CONTROLLER)` le manda una copia al mitigador para que cuente. El bloqueo sigue siendo `DROP` a prioridad 1000, que supera todo.

**La jerarquía de prioridades queda así:**

| Prioridad | Quién | Qué hace |
|---|---|---|
| **1000** | mitigador | DROP (bloqueo del atacante) |
| **200** | mitigador | Mirror → controller + NORMAL forward |
| **100** | dc_switch | Forwarding normal aprendido |
| **0** | dc_switch | Table-miss → controller |

---

## Cómo actualizar

Solo necesitas copiar los dos archivos nuevos:

```bash
# Reemplaza los archivos en tu proyecto
cp infra/controller/ddos_mitigator.py  SdnShare/infra/controller/
cp infra/attacks/ddos_demo.py          SdnShare/infra/attacks/

# Reinicia solo el controller (mininet no necesita reiniciarse)
docker compose up -d --force-recreate controller

# Verifica que v3 cargó
docker compose logs controller | grep "Mitigator v3"
# Debe aparecer: [DDoS] ══ Mitigator v3 (mirror) iniciado ══

# Lanza la demo
make topo
# mininet> py exec(open('infra/attacks/ddos_demo.py').read())
```

El `ddos_demo.py` v3 también tiene corregido el bug `has_hping3 is not defined` que aparecía en tu consola — las funciones helper ahora están definidas en scope global antes de usarse.