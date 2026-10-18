#include <unity.h>

#include "calibration.h"
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

int main() {
  UNITY_BEGIN();
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
  return UNITY_END();
}
