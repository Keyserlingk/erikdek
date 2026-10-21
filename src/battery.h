#pragma once

// Battery voltage through a resistor divider on an ADC pin. Not wired yet: without
// ERKDEK_BATTERY_PIN (see platformio.ini) batteryVolts() returns NAN, which the
// status sends as "not measured".
void batteryBegin();
float batteryVolts();
