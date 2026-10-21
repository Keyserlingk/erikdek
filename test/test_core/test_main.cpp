#include <unity.h>

#include "ble_protocol.h"
#include "calibration.h"
#include "console_command.h"
#include "rate_meter.h"
#include "ring_buffer.h"

void setUp() {}
void tearDown() {}

void test_calibration_converts_raw_to_kg() {
  Calibration cal;
  cal.offset = 1000;
  cal.countsPerKg = 500.0f;
  TEST_ASSERT_FLOAT_WITHIN(1e-4, 0.0f, cal.toKg(1000));
  TEST_ASSERT_FLOAT_WITHIN(1e-4, 2.0f, cal.toKg(2000));
  TEST_ASSERT_FLOAT_WITHIN(1e-4, -1.0f, cal.toKg(500));
}

void test_compute_counts_per_kg() {
  float cpk = 0;
  TEST_ASSERT_TRUE(computeCountsPerKg(1000, 1000 + 20 * 14000, 20.0f, cpk) == CalResult::Ok);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 14000.0f, cpk);
}

void test_compute_counts_per_kg_swapped_wires_gives_negative_factor() {
  float cpk = 0;
  TEST_ASSERT_TRUE(computeCountsPerKg(0, -20 * 14000, 20.0f, cpk) == CalResult::Ok);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, -14000.0f, cpk);
  Calibration cal;
  cal.countsPerKg = cpk;
  TEST_ASSERT_FLOAT_WITHIN(1e-3, 20.0f, cal.toKg(-20 * 14000));
}

void test_compute_counts_per_kg_rejects_bad_input() {
  float cpk = 123;
  TEST_ASSERT_TRUE(computeCountsPerKg(0, 100000, 0.0f, cpk) == CalResult::BadWeight);
  TEST_ASSERT_TRUE(computeCountsPerKg(0, 100000, -5.0f, cpk) == CalResult::BadWeight);
  TEST_ASSERT_TRUE(computeCountsPerKg(0, 4999, 10.0f, cpk) == CalResult::TooSmall);
  TEST_ASSERT_TRUE(computeCountsPerKg(0, -4999, 10.0f, cpk) == CalResult::TooSmall);
  TEST_ASSERT_EQUAL_FLOAT(123, cpk);  // untouched on failure
}

void test_averager_averages_target_count() {
  RawAverager avg;
  avg.reset(4);
  TEST_ASSERT_FALSE(avg.add(10));
  TEST_ASSERT_FALSE(avg.add(20));
  TEST_ASSERT_FALSE(avg.add(30));
  TEST_ASSERT_TRUE(avg.add(40));
  TEST_ASSERT_EQUAL_INT32(25, avg.average());
  avg.add(1000000);  // ignored once done
  TEST_ASSERT_EQUAL_INT32(25, avg.average());
}

void test_averager_handles_large_values() {
  RawAverager avg;
  avg.reset(3);
  avg.add(8000000);
  avg.add(8000000);
  avg.add(8000003);
  TEST_ASSERT_EQUAL_INT32(8000001, avg.average());
}

void test_averager_idle_after_zero_target() {
  RawAverager avg;
  avg.reset(0);
  TEST_ASSERT_FALSE(avg.done());
  TEST_ASSERT_FALSE(avg.add(5));
}

void test_rate_meter_measures_80hz() {
  RateMeter meter(2000);
  // 80 Hz = 12.5 ms per sample; alternate 12 and 13 ms.
  uint32_t t = 5000;
  for (int i = 0; i < 400; i++) {
    meter.tick(t);
    t += (i % 2) ? 13 : 12;
  }
  TEST_ASSERT_FLOAT_WITHIN(1.0f, 80.0f, meter.rateHz());
}

void test_rate_meter_measures_10hz() {
  RateMeter meter(2000);
  for (uint32_t t = 0; t < 5000; t += 100) meter.tick(t);
  TEST_ASSERT_FLOAT_WITHIN(0.6f, 10.0f, meter.rateHz());
}

void test_ring_buffer_fifo_and_overflow() {
  RingBuffer<int, 4> rb;  // holds 3
  TEST_ASSERT_TRUE(rb.push(1));
  TEST_ASSERT_TRUE(rb.push(2));
  TEST_ASSERT_TRUE(rb.push(3));
  TEST_ASSERT_FALSE(rb.push(4));
  TEST_ASSERT_EQUAL(1u, rb.dropped());
  TEST_ASSERT_EQUAL(3u, rb.size());

  int v;
  TEST_ASSERT_TRUE(rb.pop(v));
  TEST_ASSERT_EQUAL(1, v);
  TEST_ASSERT_TRUE(rb.push(5));  // wraps around
  TEST_ASSERT_TRUE(rb.pop(v));
  TEST_ASSERT_EQUAL(2, v);
  TEST_ASSERT_TRUE(rb.pop(v));
  TEST_ASSERT_EQUAL(3, v);
  TEST_ASSERT_TRUE(rb.pop(v));
  TEST_ASSERT_EQUAL(5, v);
  TEST_ASSERT_FALSE(rb.pop(v));
}

// Byte vectors shared with test/js/bleprotocol.test.js.
void test_ble_encode_samples() {
  const float kg[] = {0.0f, 20.25f, -1.5f, 400.0f};
  uint8_t buf[32];
  size_t n = ble::encodeSamples(buf, 258, 1000, 12500, kg, 4);
  const uint8_t expected[] = {0x02, 0x01, 0xE8, 0x03, 0x00, 0x00, 0xD4, 0x30,
                              0x00, 0x00, 0xE9, 0x07, 0x6A, 0xFF, 0xFF, 0x7F};
  TEST_ASSERT_EQUAL(sizeof(expected), n);
  TEST_ASSERT_EQUAL_HEX8_ARRAY(expected, buf, n);
}

void test_ble_force_units_round_and_clamp() {
  TEST_ASSERT_EQUAL_INT16(2, ble::forceUnits(0.015f));
  TEST_ASSERT_EQUAL_INT16(-2, ble::forceUnits(-0.015f));
  TEST_ASSERT_EQUAL_INT16(32767, ble::forceUnits(1000.0f));
  TEST_ASSERT_EQUAL_INT16(-32767, ble::forceUnits(-1000.0f));
  TEST_ASSERT_EQUAL(6u, ble::samplesPerPacket(20));   // default MTU 23
  TEST_ASSERT_EQUAL(119u, ble::samplesPerPacket(247));
  TEST_ASSERT_EQUAL(0u, ble::samplesPerPacket(8));
}

void test_ble_encode_status_and_events() {
  uint8_t buf[16];
  size_t n = ble::encodeStatus(buf, true, false, 80.04f, 16000.0f, 123456);
  const uint8_t status[] = {0x01, 0x20, 0x03, 0x00, 0x00, 0x7A, 0x46, 0x40, 0xE2, 0x01, 0x00};
  TEST_ASSERT_EQUAL(sizeof(status), n);
  TEST_ASSERT_EQUAL_HEX8_ARRAY(status, buf, n);

  const uint8_t calibrated[] = {0x02, 0x01, 0x00, 0x00, 0x7A, 0x46};
  TEST_ASSERT_EQUAL(sizeof(calibrated), ble::encodeCalibrated(buf, true, 16000.0f));
  TEST_ASSERT_EQUAL_HEX8_ARRAY(calibrated, buf, sizeof(calibrated));

  const uint8_t calError[] = {0x03, 0x02};
  TEST_ASSERT_EQUAL(2u, ble::encodeCalError(buf, ble::CalErrTooSmall));
  TEST_ASSERT_EQUAL_HEX8_ARRAY(calError, buf, 2);

  TEST_ASSERT_EQUAL(1u, ble::encodeTared(buf));
  TEST_ASSERT_EQUAL_HEX8(0x01, buf[0]);
}

void test_ble_parse_commands() {
  ble::ParsedCommand cmd;
  const uint8_t calibrate[] = {0x02, 0x00, 0x00, 0xA0, 0x41};  // 20.0
  TEST_ASSERT_TRUE(ble::parseCommand(calibrate, sizeof(calibrate), cmd));
  TEST_ASSERT_EQUAL(ble::CmdCalibrate, cmd.op);
  TEST_ASSERT_EQUAL_FLOAT(20.0f, cmd.value);

  const uint8_t setCal[] = {0x04, 0x00, 0x00, 0x7A, 0x46};  // 16000.0
  TEST_ASSERT_TRUE(ble::parseCommand(setCal, sizeof(setCal), cmd));
  TEST_ASSERT_EQUAL_FLOAT(16000.0f, cmd.value);

  const uint8_t tare[] = {0x01};
  TEST_ASSERT_TRUE(ble::parseCommand(tare, 1, cmd));
  TEST_ASSERT_EQUAL(ble::CmdTare, cmd.op);

  TEST_ASSERT_FALSE(ble::parseCommand(calibrate, 3, cmd));  // value missing
  const uint8_t unknown[] = {0x09};
  TEST_ASSERT_FALSE(ble::parseCommand(unknown, 1, cmd));
  TEST_ASSERT_FALSE(ble::parseCommand(unknown, 0, cmd));
}

void test_console_parses_commands() {
  TEST_ASSERT_TRUE(parseConsoleLine("t").op == ConsoleOp::Tare);
  TEST_ASSERT_TRUE(parseConsoleLine("  T \r").op == ConsoleOp::Tare);
  TEST_ASSERT_TRUE(parseConsoleLine("r").op == ConsoleOp::CalReset);
  TEST_ASSERT_TRUE(parseConsoleLine("f").op == ConsoleOp::Fast);
  TEST_ASSERT_TRUE(parseConsoleLine("s").op == ConsoleOp::Status);
  TEST_ASSERT_TRUE(parseConsoleLine("?").op == ConsoleOp::Help);
  TEST_ASSERT_TRUE(parseConsoleLine("").op == ConsoleOp::None);
  TEST_ASSERT_TRUE(parseConsoleLine("   ").op == ConsoleOp::None);
  ConsoleCommand c = parseConsoleLine("c 20.5");
  TEST_ASSERT_TRUE(c.op == ConsoleOp::Calibrate);
  TEST_ASSERT_FLOAT_WITHIN(1e-4, 20.5f, c.kg);
}

void test_console_rejects_bad_input() {
  TEST_ASSERT_TRUE(parseConsoleLine("c").op == ConsoleOp::Invalid);
  TEST_ASSERT_TRUE(parseConsoleLine("c 0").op == ConsoleOp::Invalid);
  TEST_ASSERT_TRUE(parseConsoleLine("c -5").op == ConsoleOp::Invalid);
  TEST_ASSERT_TRUE(parseConsoleLine("c 20kg").op == ConsoleOp::Invalid);
  TEST_ASSERT_TRUE(parseConsoleLine("c 400").op == ConsoleOp::Invalid);
  TEST_ASSERT_TRUE(parseConsoleLine("t 5").op == ConsoleOp::Invalid);
  TEST_ASSERT_TRUE(parseConsoleLine("tare").op == ConsoleOp::Invalid);
  TEST_ASSERT_TRUE(parseConsoleLine("x").op == ConsoleOp::Invalid);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_ble_encode_samples);
  RUN_TEST(test_ble_force_units_round_and_clamp);
  RUN_TEST(test_ble_encode_status_and_events);
  RUN_TEST(test_ble_parse_commands);
  RUN_TEST(test_calibration_converts_raw_to_kg);
  RUN_TEST(test_compute_counts_per_kg);
  RUN_TEST(test_compute_counts_per_kg_swapped_wires_gives_negative_factor);
  RUN_TEST(test_compute_counts_per_kg_rejects_bad_input);
  RUN_TEST(test_averager_averages_target_count);
  RUN_TEST(test_averager_handles_large_values);
  RUN_TEST(test_averager_idle_after_zero_target);
  RUN_TEST(test_rate_meter_measures_80hz);
  RUN_TEST(test_rate_meter_measures_10hz);
  RUN_TEST(test_ring_buffer_fifo_and_overflow);
  RUN_TEST(test_console_parses_commands);
  RUN_TEST(test_console_rejects_bad_input);
  return UNITY_END();
}
