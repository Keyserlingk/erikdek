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
  RUN_TEST(test_averager_averages_target_count);
  RUN_TEST(test_averager_handles_large_values);
  RUN_TEST(test_averager_idle_after_zero_target);
  RUN_TEST(test_rate_meter_measures_80hz);
  RUN_TEST(test_rate_meter_measures_10hz);
  RUN_TEST(test_ring_buffer_fifo_and_overflow);
  return UNITY_END();
}
