#include "telemetry-inline.h"
#include <cassert>
#include <iostream>
#include <limits>

int main() {
  using namespace asqac;
  // A stationary sensor reporting gravity in m/s^2 must upload az=1 g.
  Sample normal = cloudSample(5, 1013.25, 4, 0, 0, 9.80665,
                             0.1, -0.2, 0.3, 0, 0, 1);
  assert(std::fabs(normal.az - 1) < 0.000001);
  assert(normal.ax == 0 && validSample(normal));
  assert(degrees180(540) == -180 && degrees180(-181) == 179);
  assert(std::fabs(blendAngle(179,-179,0.02)-179.04)<0.00001);
  assert(std::fabs(blendAngle(-179,179,0.02)+179.04)<0.00001);
  assert(std::fabs(pressureAltitude(1013.25,1013.25))<0.00001);
  assert(pressureAltitude(1000,1013.25)>100 && pressureAltitude(1000,1013.25)<120);
  assert(pressureAltitude(1014.25,1013.25)<0);
  HeightReference baseline;
  baseline.observe(1009.7,0); assert(baseline.count==0); // no UTC, no reference
  for(unsigned i=0;i<15;++i) baseline.observe(1009.7,std::time(nullptr));
  assert(!baseline.recorded_at);
  baseline.observe(1009.7,std::time(nullptr));
  assert(baseline.recorded_at && std::fabs(baseline.pressure-1009.7)<0.00001);
  baseline.observe(990,std::time(nullptr));
  assert(std::fabs(baseline.pressure-1009.7)<0.00001); // don't move the zero while travelling
  Frame frame = {1, std::time(nullptr), normal, -55, 0, 123};
  // Healthy HTTP time counts toward the interval instead of being added to it.
  assert(UPLOAD_INTERVAL_MS == 1000 && SAMPLE_INTERVAL_MS == 500);
  assert(uploadWait(400, 201) == 800);
  assert(uploadWait(4198, 201) == 800); // slow TLS must not trigger an immediate rate-limited retry
  assert(uploadWait(3000, 201) == 800);
  assert(uploadWait(400, 429) == 1500);
  assert(uploadWait(400, 401) == 60000);
  assert(uploadWait(400, -1) == 10000);
  char payload[900];
  assert(encodeFrame(frame, "CAP0001-ESP32-001", payload, sizeof(payload)));
  std::cout << payload << '\n';

  // A brief drop/light spike must survive later normal samples until reset.
  PeakWindow window;
  window.observeMotion(0, 0, 1);
  window.observeMotion(0, 0, 4);
  window.observeMotion(0, 0, 1);
  window.observeLight(3);
  window.observeLight(250);
  window.observeLight(4);
  assert(window.shock == 4 && window.light == 250);
  assert(window.healthy && window.motionSeen && window.lightSeen);
  frame.sample = cloudSample(12.5, 1013.25, window.light, 0, 0, 9.80665,
                            0, 0, 0, 60, -45, window.shock);
  frame.sample.reference_pressure_hpa=1013.25;
  frame.sample.height_reference_at=frame.recorded_at-10;
  assert(encodeFrame(frame, "CAP0001-ESP32-001", payload, sizeof(payload)));
  std::cout << payload << '\n';
  window.reset();
  window.observeMotion(0, 0, 0);
  window.observeLight(0);
  assert(window.shock == 0 && window.light == 0 && window.motionSeen && window.lightSeen);
  window.observeLight(std::numeric_limits<double>::quiet_NaN());
  assert(!window.healthy);

  // Invalid values and truncated JSON must never be uploaded as valid packets.
  assert(!encodeFrame(frame, "bad\"uid", payload, sizeof(payload)));
  assert(!encodeFrame(frame, "CAP0001-ESP32-001", payload, 20));
  frame.sample.temp_c = std::numeric_limits<double>::infinity();
  assert(!encodeFrame(frame, "CAP0001-ESP32-001", payload, sizeof(payload)));
  frame.sample = normal;
  frame.rssi = 1;
  assert(!encodeFrame(frame, "CAP0001-ESP32-001", payload, sizeof(payload)));

  // Overflow during a slow HTTPS request must not cause its completion to pop
  // a different packet. Preserve FIFO ordering and the bounded memory limit.
  FrameQueue queue;
  Frame head = {};
  assert(!queue.peek(head));
  for (std::uint32_t i = 1; i <= QUEUE_CAPACITY; ++i) {
    frame.sequence = i; queue.push(frame);
  }
  assert(queue.peek(head) && head.sequence == 1);
  frame.sequence = QUEUE_CAPACITY + 1; queue.push(frame);
  assert(queue.size() == QUEUE_CAPACITY && queue.dropped() == 1);
  assert(!queue.acknowledge(head.sequence));
  assert(queue.peek(head) && head.sequence == 2);
  assert(queue.acknowledge(2) && queue.size() == QUEUE_CAPACITY - 1);
  for (std::uint32_t i = 3; i <= QUEUE_CAPACITY + 1; ++i) {
    assert(queue.peek(head) && head.sequence == i);
    assert(queue.acknowledge(i));
  }
  assert(queue.size() == 0 && !queue.peek(head));
  // A slow request/outage can accumulate many samples. Batch replay must clear
  // the backlog rather than remove one frame while two more are generated.
  Frame batch[BATCH_CAPACITY];
  for (unsigned i=1;i<=13;++i) {
    frame.sequence=i; frame.rssi=-55; frame.recorded_ms=i*10; queue.push(frame);
  }
  const std::size_t copied=queue.copyBatch(batch,BATCH_CAPACITY);
  assert(copied==13 && batch[0].sequence==1 && batch[12].sequence==13);
  char batchJson[15000];
  assert(encodeBatch(batch,copied,"CAP0001-ESP32-001",batchJson,sizeof(batchJson)));
  std::cout << batchJson << '\n';
  assert(!encodeBatch(batch,copied,"CAP0001-ESP32-001",batchJson,20));
  for (std::size_t i=0;i<copied;++i) assert(queue.acknowledge(batch[i].sequence));
  assert(queue.size()==0);
  frame.recorded_ms=1000;
  assert(!encodeFrame(frame,"CAP0001-ESP32-001",payload,sizeof(payload)));
  HeightReference moving;
  for(unsigned i=0;i<16;++i)moving.observe(1000+i,std::time(nullptr));
  assert(!moving.recorded_at); // a moving/unstable baseline must not be accepted
}
