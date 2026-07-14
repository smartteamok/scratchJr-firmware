# ScratchJr firmware

Descarga un `.hex` con nombre Bluetooth personalizado, listo para copiar a la placa.

Sitio: https://smartteamok.github.io/scratchJr-firmware/

## Variantes

La web ofrece dos placas:

- **Classic micro:bit** (`docs/firmware/scratchjr-microbit-base.hex`): sensores y matriz LED integrados.
- **mb-kit (IIC modules)** (`docs/firmware/scratchjr-mbkit-base.hex`): módulos IIC externos con sensores configurables.

En ambos casos el navegador parchea el `.hex` localmente (nada se sube a un servidor).

## Nombre Bluetooth y prefijo `sjr-`

El prefijo `sjr-` es obligatorio: la app ScratchJr lo usa para filtrar dispositivos. Es **transparente** para el usuario —no se escribe ni se ve en la web ni en la pantalla de la placa— pero siempre queda embebido en el nombre BLE anunciado. El usuario solo escribe el sufijo (hasta 16 caracteres ASCII).

## Configuración de sensores (solo mb-kit)

Al elegir mb-kit se habilita un panel con los tunables del kit (umbrales de cerca/luz/húmedo, polaridad de humedad, potencia PWM de motores, unidad de tiempo de motion/wait, brillo del anillo, paso de animación, swap e inversión de motores). Esos valores se escriben en un bloque de configuración embebido en el binario (magic `SJRMBK01` + CRC-32). El layout es la fuente de verdad compartida con el firmware: ver `MBKIT-GUIDE.md §6.1` en el repo `ScratchJr-Backend`.

## Actualizar firmware base

Los `.hex` base se copian automáticamente desde el repo `ScratchJr-Backend` al compilar cada variante (post-build de CMake) a `docs/firmware/`. Ambos deben conservar el slot de 20 bytes `sjr-` + espacios para el parcheo del nombre; el de mb-kit además lleva el bloque `SJRMBK01`.
