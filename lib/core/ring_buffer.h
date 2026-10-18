#pragma once

#include <atomic>
#include <stddef.h>

// Lock-free single-producer/single-consumer ring buffer.
// The sensor task pushes, the network loop pops. Holds N - 1 items.
template <typename T, size_t N>
class RingBuffer {
  static_assert(N >= 2, "RingBuffer needs at least 2 slots");

 public:
  // Returns false (and drops the item) when full.
  bool push(const T& item) {
    size_t head = head_.load(std::memory_order_relaxed);
    size_t next = (head + 1) % N;
    if (next == tail_.load(std::memory_order_acquire)) {
      dropped_.fetch_add(1, std::memory_order_relaxed);
      return false;
    }
    buf_[head] = item;
    head_.store(next, std::memory_order_release);
    return true;
  }

  bool pop(T& out) {
    size_t tail = tail_.load(std::memory_order_relaxed);
    if (tail == head_.load(std::memory_order_acquire)) return false;
    out = buf_[tail];
    tail_.store((tail + 1) % N, std::memory_order_release);
    return true;
  }

  size_t size() const {
    size_t head = head_.load(std::memory_order_acquire);
    size_t tail = tail_.load(std::memory_order_acquire);
    return (head + N - tail) % N;
  }

  size_t dropped() const { return dropped_.load(std::memory_order_relaxed); }

 private:
  T buf_[N];
  std::atomic<size_t> head_{0};
  std::atomic<size_t> tail_{0};
  std::atomic<size_t> dropped_{0};
};
