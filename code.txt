// ASQAC: single-file firmware for your existing ESP32 sensor circuit.
// Board: ESP32 Dev Module (classic ESP32), Arduino ESP32 core 3.x.
// MPU6050 SDA33/SCL32; BH1750 SDA18/SCL19; BMP280 SDA27/SCL14.
// All sensors: 3.3 V and common ground. Serial Monitor: 115200 baud.
// Wi-Fi, registered device credential and TLS certificate are included below.
// Paste this entire file into ONE Arduino sketch. No custom headers or HTML.
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <math.h>
#include <time.h>
#include <sys/time.h>
#include <atomic>
// ================= YOUR WI-FI =================
const char* WIFI_SSID = "abcd";
const char* WIFI_PASSWORD = "12345678";

// ================= ASQAC BACKEND =================
// Registered CAP0001 demo device. No Supabase administrative key is used.
const char* TELEMETRY_URL = "https://chhpbpqoaikbcicxdnzj.supabase.co/functions/v1/telemetry";
const char* DEVICE_UID = "CAP0001-ESP32-001";
const char* DEVICE_TOKEN = "ImAnvVWlySFqmB0JL8AQTs_MuVXLC0uPPKQFtRBMmbE";

// Trusted endpoint root certificate. HTTPS verification stays enabled.
const char* TLS_ROOT_CA = R"PEM(
-----BEGIN CERTIFICATE-----
MIIDejCCAmKgAwIBAgIQf+UwvzMTQ77dghYQST2KGzANBgkqhkiG9w0BAQsFADBX
MQswCQYDVQQGEwJCRTEZMBcGA1UEChMQR2xvYmFsU2lnbiBudi1zYTEQMA4GA1UE
CxMHUm9vdCBDQTEbMBkGA1UEAxMSR2xvYmFsU2lnbiBSb290IENBMB4XDTIzMTEx
NTAzNDMyMVoXDTI4MDEyODAwMDA0MlowRzELMAkGA1UEBhMCVVMxIjAgBgNVBAoT
GUdvb2dsZSBUcnVzdCBTZXJ2aWNlcyBMTEMxFDASBgNVBAMTC0dUUyBSb290IFI0
MHYwEAYHKoZIzj0CAQYFK4EEACIDYgAE83Rzp2iLYK5DuDXFgTB7S0md+8Fhzube
Rr1r1WEYNa5A3XP3iZEwWus87oV8okB2O6nGuEfYKueSkWpz6bFyOZ8pn6KY019e
WIZlD6GEZQbR3IvJx3PIjGov5cSr0R2Ko4H/MIH8MA4GA1UdDwEB/wQEAwIBhjAd
BgNVHSUEFjAUBggrBgEFBQcDAQYIKwYBBQUHAwIwDwYDVR0TAQH/BAUwAwEB/zAd
BgNVHQ4EFgQUgEzW63T/STaj1dj8tT7FavCUHYwwHwYDVR0jBBgwFoAUYHtmGkUN
l8qJUC99BM00qP/8/UswNgYIKwYBBQUHAQEEKjAoMCYGCCsGAQUFBzAChhpodHRw
Oi8vaS5wa2kuZ29vZy9nc3IxLmNydDAtBgNVHR8EJjAkMCKgIKAehhxodHRwOi8v
Yy5wa2kuZ29vZy9yL2dzcjEuY3JsMBMGA1UdIAQMMAowCAYGZ4EMAQIBMA0GCSqG
SIb3DQEBCwUAA4IBAQAYQrsPBtYDh5bjP2OBDwmkoWhIDDkic574y04tfzHpn+cJ
odI2D4SseesQ6bDrarZ7C30ddLibZatoKiws3UL9xnELz4ct92vID24FfVbiI1hY
+SW6FoVHkNeWIP0GCbaM4C6uVdF5dTUsMVs/ZbzNnIdCp5Gxmx5ejvEau8otR/Cs
kGN+hr/W5GvT1tMBjgWKZ1i4//emhA1JG1BbPzoLJQvyEotc03lXjTaCzv8mEbep
8RqZ7a2CPsgRbuvTPBwcOMBBmuFeU88+FSBX6+7iP0il8b4Z0QFqIwwMHfs/L6K1
vepuoxtGzi4CZ68zJpiq1UvSqTbFJjtbD4seiMHl
-----END CERTIFICATE-----
)PEM";

// ASQAC_TELEMETRY_BEGIN
// Transport contract shared by the sketch and the native firmware checks.
// No Wi-Fi, credentials or Arduino-specific libraries are needed here.
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <ctime>

namespace asqac {
constexpr double STANDARD_GRAVITY = 9.80665;
constexpr std::size_t QUEUE_CAPACITY = 360; // 3 minutes at 500 ms; retain outage evidence.
constexpr std::size_t BATCH_CAPACITY = 16;
constexpr std::uint32_t SAMPLE_INTERVAL_MS = 500;
constexpr std::uint32_t UPLOAD_INTERVAL_MS = 1000; // Batch API minimum is 750 ms.
inline std::uint32_t uploadWait(std::uint32_t elapsed, int status) {
  if (status == 401 || status == 403) return 60000;
  if (status == 429) return 1500;
  if (status < 200 || status >= 500) return 10000;
  // A slow TLS/network request may reach the database near its END. Never
  // immediately retry just because the request took longer than one second.
  // Waiting at least 800 ms AFTER the response guarantees margin over the
  // server's 750 ms acceptance limit, independent of handshake duration.
  const std::uint32_t remaining = elapsed >= UPLOAD_INTERVAL_MS ? 0 : UPLOAD_INTERVAL_MS - elapsed;
  return remaining > 800 ? remaining : 800;
}

struct Sample {
  double temp_c, pressure_hpa, lux;
  double ax, ay, az, gx, gy, gz;
  double pitch_deg, roll_deg, shock_g;
  double sea_level_pressure_hpa, reference_pressure_hpa;
  std::time_t height_reference_at;
};
struct Frame {
  std::uint32_t sequence;
  std::time_t recorded_at;
  Sample sample;
  int rssi;
  std::uint32_t captured_ms; // Diagnostics only; not sent to the backend.
  unsigned recorded_ms;
};

inline double degrees180(double angle) {
  double wrapped = std::fmod(angle + 180.0, 360.0);
  if (wrapped < 0) wrapped += 360.0;
  return wrapped - 180.0;
}
inline double blendAngle(double predicted, double observed, double weight) {
  // +179 and -179 are two degrees apart, not 358. Avoid a false sweep
  // through zero when the capsule crosses the inverted orientation.
  return degrees180(predicted + weight * degrees180(observed - predicted));
}

// Sensor calculations use m/s^2; uploaded acceleration is converted to g.
inline Sample cloudSample(double temp, double pressure, double lightPeak,
                          double axMs2, double ayMs2, double azMs2,
                          double gx, double gy, double gz,
                          double pitch, double roll, double shockPeak) {
  return {temp, pressure, lightPeak,
          axMs2 / STANDARD_GRAVITY, ayMs2 / STANDARD_GRAVITY, azMs2 / STANDARD_GRAVITY,
          gx, gy, gz, degrees180(pitch), degrees180(roll), shockPeak, 1013.25, 0, 0};
}

inline double pressureAltitude(double pressure, double reference) {
  return 44330.0*(1.0-std::pow(pressure/reference,0.1903));
}
struct HeightReference {
  double pressure = 0, sum = 0, minimum = 1200, maximum = 0;
  unsigned count = 0;
  std::time_t recorded_at = 0;
  void observe(double value, std::time_t epoch) {
    if (recorded_at || !std::isfinite(value) || value<300 || value>1200 || epoch<1735689600) return;
    // First stable 16-sample window after clock/warmup. Keep still at startup.
    if (value<minimum) minimum=value;
    if (value>maximum) maximum=value;
    if (maximum-minimum>0.3) {
      sum=value; minimum=maximum=value; count=1; return;
    }
    sum+=value; ++count;
    if (count>=16) { pressure=sum/count; recorded_at=epoch; }
  }
};

inline bool inRange(double value, double minimum, double maximum) {
  return std::isfinite(value) && value >= minimum && value <= maximum;
}
inline bool validSample(const Sample& s) {
  return inRange(s.temp_c, -40, 85) && inRange(s.pressure_hpa, 300, 1200) &&
         inRange(s.lux, 0, 65535) && inRange(s.ax, -16, 16) &&
         inRange(s.ay, -16, 16) && inRange(s.az, -16, 16) &&
         inRange(s.gx, -2000, 2000) && inRange(s.gy, -2000, 2000) &&
         inRange(s.gz, -2000, 2000) && inRange(s.pitch_deg, -180, 180) &&
         inRange(s.roll_deg, -180, 180) && inRange(s.shock_g, 0, 28) &&
         inRange(s.sea_level_pressure_hpa,800,1100) &&
         ((s.reference_pressure_hpa==0 && s.height_reference_at==0) ||
          (inRange(s.reference_pressure_hpa,300,1200) && s.height_reference_at>=1735689600));
}
inline bool validUid(const char* uid) {
  if (!uid) return false;
  const std::size_t length = std::strlen(uid);
  if (length < 3 || length > 80) return false;
  for (std::size_t i = 0; i < length; ++i) {
    const char c = uid[i];
    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
          (c >= '0' && c <= '9') || c == '_' || c == '-')) return false;
  }
  return true;
}

inline bool encodeFrame(const Frame& frame, const char* uid, char* out, std::size_t size) {
  if (!validUid(uid) || !validSample(frame.sample) ||
      frame.rssi < -127 || frame.rssi > 0 || frame.recorded_at < 1735689600 || frame.recorded_ms > 999) return false;
  std::tm utc = {};
#if defined(ARDUINO)
  if (!gmtime_r(&frame.recorded_at, &utc)) return false;
#else
  const std::tm* converted = std::gmtime(&frame.recorded_at);
  if (!converted) return false;
  utc = *converted;
#endif
  char seconds[24], stamp[28];
  if (!std::strftime(seconds, sizeof(seconds), "%Y-%m-%dT%H:%M:%S", &utc)) return false;
  std::snprintf(stamp, sizeof(stamp), "%s.%03uZ", seconds, frame.recorded_ms);
  const Sample& s = frame.sample;
  char reference[180] = "";
  if (s.reference_pressure_hpa>0) {
    if (s.height_reference_at>frame.recorded_at) return false;
    std::tm refUtc = {};
#if defined(ARDUINO)
    if (!gmtime_r(&s.height_reference_at,&refUtc)) return false;
#else
    const std::tm* refConverted=std::gmtime(&s.height_reference_at);
    if (!refConverted) return false;
    refUtc=*refConverted;
#endif
    char refStamp[28];
    if (!std::strftime(refStamp,sizeof(refStamp),"%Y-%m-%dT%H:%M:%SZ",&refUtc)) return false;
    std::snprintf(reference,sizeof(reference),",\"reference_pressure_hpa\":%.5f,\"height_reference_at\":\"%s\"",s.reference_pressure_hpa,refStamp);
  }
  const int length = std::snprintf(out, size,
    "{\"device_uid\":\"%s\",\"recorded_at\":\"%s\","
    "\"temp_c\":%.4f,\"pressure_hpa\":%.4f,\"lux\":%.4f,"
    "\"ax\":%.5f,\"ay\":%.5f,\"az\":%.5f,"
    "\"gx\":%.4f,\"gy\":%.4f,\"gz\":%.4f,"
    "\"pitch_deg\":%.4f,\"roll_deg\":%.4f,\"shock_g\":%.5f,"
    "\"rssi\":%d,\"simulated\":false,\"sea_level_pressure_hpa\":%.4f%s}",
    uid, stamp, s.temp_c, s.pressure_hpa, s.lux, s.ax, s.ay, s.az,
    s.gx, s.gy, s.gz, s.pitch_deg, s.roll_deg, s.shock_g, frame.rssi,s.sea_level_pressure_hpa,reference);
  return length > 0 && static_cast<std::size_t>(length) < size;
}

inline bool encodeBatch(const Frame* frames, std::size_t count, const char* uid,
                        char* out, std::size_t size) {
  if (!frames || count < 1 || count > BATCH_CAPACITY || size < 18) return false;
  const char* prefix="{\"readings\":[";
  std::size_t used=std::strlen(prefix);
  std::memcpy(out,prefix,used);
  for (std::size_t i=0; i<count; ++i) {
    if (i) { if (used+1>=size) return false; out[used++]=','; }
    char row[900];
    if (!encodeFrame(frames[i],uid,row,sizeof(row))) return false;
    const std::size_t length=std::strlen(row);
    if (used+length+3>size) return false;
    std::memcpy(out+used,row,length); used+=length;
  }
  out[used++]=']'; out[used++]='}'; out[used]='\0';
  return true;
}

struct PeakWindow {
  double shock = 0, light = 0;
  bool motionSeen = false, lightSeen = false, healthy = true;
  void observeMotion(double axG, double ayG, double azG) {
    if (!std::isfinite(axG) || !std::isfinite(ayG) || !std::isfinite(azG)) {
      healthy = false; return;
    }
    const double magnitude = std::sqrt(axG * axG + ayG * ayG + azG * azG);
    if (magnitude > shock) shock = magnitude;
    motionSeen = true;
  }
  void observeLight(double lux) {
    if (!inRange(lux, 0, 65535)) { healthy = false; return; }
    if (lux > light) light = lux;
    lightSeen = true;
  }
  void reset() {
    shock = light = 0;
    motionSeen = lightSeen = false;
    healthy = true;
  }
};

// Caller holds its FreeRTOS mutex. Sequence-aware acknowledgement prevents an
// in-flight upload from removing a newer frame after an overflow dropped it.
class FrameQueue {
  Frame frames_[QUEUE_CAPACITY] = {};
  std::size_t head_ = 0, count_ = 0;
  std::uint32_t dropped_ = 0;
public:
  void push(const Frame& frame) {
    if (count_ == QUEUE_CAPACITY) {
      head_ = (head_ + 1) % QUEUE_CAPACITY; --count_; ++dropped_;
    }
    frames_[(head_ + count_) % QUEUE_CAPACITY] = frame;
    ++count_;
  }
  bool peek(Frame& frame) const {
    if (!count_) return false;
    frame = frames_[head_]; return true;
  }
  std::size_t copyBatch(Frame* out, std::size_t capacity) const {
    const std::size_t count=count_<capacity ? count_ : capacity;
    for (std::size_t i=0; i<count; ++i) out[i]=frames_[(head_+i)%QUEUE_CAPACITY];
    return count;
  }
  bool acknowledge(std::uint32_t sequence) {
    if (!count_ || frames_[head_].sequence != sequence) return false;
    head_ = (head_ + 1) % QUEUE_CAPACITY; --count_; return true;
  }
  std::size_t size() const { return count_; }
  std::uint32_t dropped() const { return dropped_; }
};
} // namespace asqac

// ASQAC_TELEMETRY_END
#if !defined(CONFIG_IDF_TARGET_ESP32)
#error "Select ESP32 Dev Module for this circuit variant; use firmware/asqac for ESP32-C3."
#endif
constexpr uint32_t PACKET_MS = asqac::SAMPLE_INTERVAL_MS, WIFI_RETRY_MS = 15000;
asqac::FrameQueue packetQueue;
asqac::PeakWindow peaks;
asqac::HeightReference heightReference;
// Standard atmosphere default, NOT a measured local sea-level pressure.
constexpr double SEA_LEVEL_PRESSURE_HPA = 1013.25;
SemaphoreHandle_t packetMutex = nullptr;
std::atomic<bool> clockReady{false};
std::atomic<int> lastHttpStatus{0};
std::atomic<uint32_t> acceptedUploads{0}, rejectedUploads{0};
uint32_t lastMotionMs = 0, lastLightMs = 0, lastEnvironmentMs = 0;
uint32_t nextSequence = 1;
int64_t lastPacketEpochMs = 0;
uint32_t lastSlow = 0, lastRetry = 0, lastSerial = 0, lastPacket = 0, lastImu = 0;

// ================= PINS =================
const int MPU_SDA = 33, MPU_SCL = 32;
const int BH_SDA  = 18, BH_SCL  = 19;
const int BMP_SDA = 27, BMP_SCL = 14;

// ================= GENERIC I2C HELPERS =================
bool devAt(TwoWire &b, uint8_t addr) {
  b.beginTransmission(addr);
  return b.endTransmission() == 0;
}

bool wrReg(TwoWire &b, uint8_t addr, uint8_t reg, uint8_t val) {
  b.beginTransmission(addr);
  b.write(reg);
  b.write(val);
  return b.endTransmission() == 0;
}

bool sendCmd(TwoWire &b, uint8_t addr, uint8_t c) {
  b.beginTransmission(addr);
  b.write(c);
  return b.endTransmission() == 0;
}
bool rdBytes(TwoWire &b, uint8_t addr, uint8_t reg, uint8_t *buf, uint8_t len) {
  b.beginTransmission(addr);
  b.write(reg);
  if (b.endTransmission(false) != 0) return false;
  if (b.requestFrom(addr, (size_t)len) != len) return false;
  for (uint8_t i = 0; i < len; i++) buf[i] = b.read();
  return true;
}
int rdReg(TwoWire &b, uint8_t addr, uint8_t reg) {
  uint8_t value;
  return rdBytes(b, addr, reg, &value, 1) ? value : -1;
}
enum { BUS_NONE = -1, BUS_BH = 0, BUS_BMP = 1 };
int activeBus = BUS_NONE;
void useBus(int which) {
  if (activeBus == which) return;
  Wire.end();
  const bool ok = which == BUS_BH
    ? Wire.begin(BH_SDA, BH_SCL, 100000)
    : Wire.begin(BMP_SDA, BMP_SCL, 100000);
  Wire.setTimeOut(50);
  activeBus = ok ? which : BUS_NONE;
}
uint8_t bhAddr = 0x23;
bool bhOK = false;
float lux = 0;
bool bhStart() {
  useBus(BUS_BH);
  if (devAt(Wire, 0x23)) bhAddr = 0x23;
  else if (devAt(Wire, 0x5C)) bhAddr = 0x5C;
  else return false;
  if (!sendCmd(Wire, bhAddr, 0x01)) return false;
  delay(10);
  if (!sendCmd(Wire, bhAddr, 0x07)) return false;
  delay(10);
  if (!sendCmd(Wire, bhAddr, 0x10)) return false;
  delay(180);
  return true;
}

bool bhRead(float &out) {
  useBus(BUS_BH);
  if (Wire.requestFrom(bhAddr, (size_t)2) != 2) return false;
  uint16_t raw = (Wire.read() << 8) | Wire.read();
  out = raw / 1.2;
  return true;
}

// ================= HW-611 / BMP280 =================
uint8_t bmpAddr = 0x76;
bool bmpOK = false;
uint16_t dig_T1; int16_t dig_T2, dig_T3;
uint16_t dig_P1; int16_t dig_P2, dig_P3, dig_P4, dig_P5, dig_P6, dig_P7, dig_P8, dig_P9;
double t_fine;
float tempC_bmp = 0, pressHpa = 0;

bool bmpStart() {
  useBus(BUS_BMP);
  if (devAt(Wire, 0x76))      bmpAddr = 0x76;
  else if (devAt(Wire, 0x77)) bmpAddr = 0x77;
  else return false;

  if (!wrReg(Wire, bmpAddr, 0xE0, 0xB6)) return false;           // soft reset
  delay(50);
  unsigned long t0 = millis();
  while (millis() - t0 < 500) {
    int st = rdReg(Wire, bmpAddr, 0xF3);
    if (st >= 0 && (st & 0x01) == 0) break;
    delay(5);
  }

  uint8_t c[24];
  if (!rdBytes(Wire, bmpAddr, 0x88, c, 24)) return false;
  dig_T1 = (uint16_t)(c[1]  << 8 | c[0]);
  dig_T2 = (int16_t) (c[3]  << 8 | c[2]);
  dig_T3 = (int16_t) (c[5]  << 8 | c[4]);
  dig_P1 = (uint16_t)(c[7]  << 8 | c[6]);
  dig_P2 = (int16_t) (c[9]  << 8 | c[8]);
  dig_P3 = (int16_t) (c[11] << 8 | c[10]);
  dig_P4 = (int16_t) (c[13] << 8 | c[12]);
  dig_P5 = (int16_t) (c[15] << 8 | c[14]);
  dig_P6 = (int16_t) (c[17] << 8 | c[16]);
  dig_P7 = (int16_t) (c[19] << 8 | c[18]);
  dig_P8 = (int16_t) (c[21] << 8 | c[20]);
  dig_P9 = (int16_t) (c[23] << 8 | c[22]);
  if (dig_T1 == 0 || dig_T1 == 0xFFFF || dig_P1 == 0 || dig_P1 == 0xFFFF) return false;

  if (!wrReg(Wire, bmpAddr, 0xF5, 0x30)) return false;   // standby 62.5 ms, IIR filter x16
  if (!wrReg(Wire, bmpAddr, 0xF4, 0x57)) return false;   // temp x2, pressure x16, normal mode
  delay(100);
  return true;
}

bool bmpRead(float &tempC, float &pHpa) {
  useBus(BUS_BMP);
  uint8_t d[6];
  if (!rdBytes(Wire, bmpAddr, 0xF7, d, 6)) return false;

  int32_t adc_P = ((int32_t)d[0] << 12) | ((int32_t)d[1] << 4) | (d[2] >> 4);
  int32_t adc_T = ((int32_t)d[3] << 12) | ((int32_t)d[4] << 4) | (d[5] >> 4);
  if (adc_P == 0x80000 || adc_T == 0x80000) return false;

  double v1 = (adc_T / 16384.0 - dig_T1 / 1024.0) * dig_T2;
  double v2 = (adc_T / 131072.0 - dig_T1 / 8192.0);
  v2 = v2 * v2 * dig_T3;
  t_fine = v1 + v2;
  tempC = t_fine / 5120.0;

  v1 = t_fine / 2.0 - 64000.0;
  v2 = v1 * v1 * dig_P6 / 32768.0;
  v2 = v2 + v1 * dig_P5 * 2.0;
  v2 = v2 / 4.0 + dig_P4 * 65536.0;
  v1 = (dig_P3 * v1 * v1 / 524288.0 + dig_P2 * v1) / 524288.0;
  v1 = (1.0 + v1 / 32768.0) * dig_P1;
  if (v1 == 0) return false;
  double p = 1048576.0 - adc_P;
  p = (p - v2 / 4096.0) * 6250.0 / v1;
  v1 = dig_P9 * p * p / 2147483648.0;
  v2 = p * dig_P8 / 32768.0;
  p = p + (v1 + v2 + dig_P7) / 16.0;

  pHpa = p / 100.0;
  return isfinite(tempC) && isfinite(pHpa) && tempC >= -40 && tempC <= 85 && pHpa > 300 && pHpa < 1100;
}

bool bmpReference() {
  float temperature, pressure;
  if (!bmpRead(temperature, pressure)) return false;
  tempC_bmp = temperature; pressHpa = pressure;
  lastEnvironmentMs = millis();
  return true;
}

// ================= MPU6050 (Wire1) =================
const float ACCEL_LSB_PER_G  = 4096.0;   // +-8 g
const float GYRO_LSB_PER_DPS = 65.5;     // +-500 deg/s
const float G_TO_MS2         = 9.80665;
const float RAD2DEG          = 57.29578;

uint8_t mpuAddr = 0x68;
bool mpuOK = false;
int16_t raw[7];
float gyroBiasX = 0, gyroBiasY = 0, gyroBiasZ = 0;
float roll = 0, pitch = 0;
float axMs2 = 0, ayMs2 = 0, azMs2 = 0, gx = 0, gy = 0, gz = 0;
unsigned long lastMicros = 0;

bool mpuReadAll() {
  uint8_t d[14];
  if (!rdBytes(Wire1, mpuAddr, 0x3B, d, 14)) return false;
  for (int i = 0; i < 7; i++) raw[i] = (int16_t)((d[2 * i] << 8) | d[2 * i + 1]);
  return true;
}

bool mpuStart() {
  if (devAt(Wire1, 0x68))      mpuAddr = 0x68;
  else if (devAt(Wire1, 0x69)) mpuAddr = 0x69;
  else return false;
  if (!wrReg(Wire1, mpuAddr, 0x6B, 0x80)) return false;  delay(150);   // reset
  if (!wrReg(Wire1, mpuAddr, 0x6B, 0x00)) return false;  delay(100);   // wake up
  if (!wrReg(Wire1, mpuAddr, 0x6C, 0x00)) return false;                // all axes on
  if (!wrReg(Wire1, mpuAddr, 0x19, 0x07)) return false;                // 125 Hz
  if (!wrReg(Wire1, mpuAddr, 0x1A, 0x03)) return false;                // ~44 Hz low-pass
  if (!wrReg(Wire1, mpuAddr, 0x1B, 0x08)) return false;                // gyro +-500 deg/s
  if (!wrReg(Wire1, mpuAddr, 0x1C, 0x10)) return false;                // accel +-8 g
  delay(100);
  return true;
}

bool mpuCalibrate() {
  double sx = 0, sy = 0, sz = 0;
  int good = 0;
  for (int i = 0; i < 500; i++) {
    if (mpuReadAll()) { sx += raw[4]; sy += raw[5]; sz += raw[6]; good++; }
    delay(3);
  }
  if (good < 400) return false;
  if (good) { gyroBiasX = sx / good; gyroBiasY = sy / good; gyroBiasZ = sz / good; }
  if (mpuReadAll()) {
    roll  = atan2((float)raw[1], (float)raw[2]) * RAD2DEG;
    pitch = atan2(-(float)raw[0], sqrt((float)raw[1] * raw[1] + (float)raw[2] * raw[2])) * RAD2DEG;
  }
  lastMicros = micros();
  return true;
}

// ================= QUEUE STATUS =================
size_t queuedPackets() {
  size_t count = 0;
  if (xSemaphoreTake(packetMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
    count = packetQueue.size(); xSemaphoreGive(packetMutex);
  }
  return count;
}

// ================= CLOUD PACKETS =================
void captureCloudPacket() {
  const uint32_t now = millis();
  timeval observed; gettimeofday(&observed,nullptr);
  const time_t epoch = observed.tv_sec;
  const int64_t epochMs=(int64_t)epoch*1000+observed.tv_usec/1000;
  const bool fresh = now - lastMotionMs <= 500 && now - lastLightMs <= 2000 &&
                     now - lastEnvironmentMs <= 2000;
  if (!clockReady.load() || epochMs <= lastPacketEpochMs || !bhOK || !bmpOK || !mpuOK ||
      !fresh || !peaks.healthy || !peaks.motionSeen || !peaks.lightSeen) {
    Serial.println("ASQAC: packet skipped; waiting for UTC and a complete healthy sensor window.");
    peaks.reset(); return;
  }
  asqac::Frame frame = {};
  frame.sequence = nextSequence++;
  frame.recorded_at = epoch;
  frame.captured_ms = now;
  frame.recorded_ms = observed.tv_usec/1000;
  frame.rssi = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : -127;
  frame.sample = asqac::cloudSample(tempC_bmp, pressHpa, peaks.light,
    axMs2, ayMs2, azMs2, gx, gy, gz, pitch, roll, peaks.shock);
  frame.sample.sea_level_pressure_hpa=SEA_LEVEL_PRESSURE_HPA;
  frame.sample.reference_pressure_hpa=heightReference.pressure;
  frame.sample.height_reference_at=heightReference.recorded_at;
  if (asqac::validSample(frame.sample) &&
      xSemaphoreTake(packetMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
    const uint32_t before = packetQueue.dropped();
    packetQueue.push(frame);
    if (packetQueue.dropped() != before) Serial.println("ASQAC: offline queue full; oldest packet dropped.");
    xSemaphoreGive(packetMutex);
    lastPacketEpochMs = epochMs;
  }
  peaks.reset();
}

void acknowledgePacket(uint32_t sequence) {
  if (xSemaphoreTake(packetMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
    packetQueue.acknowledge(sequence); xSemaphoreGive(packetMutex);
  }
}

// Only this task performs HTTPS. It never accesses Wire, Wire1 or sensor globals.
// Sensor sampling remains in loop() while HTTPS runs independently.
void uploadTask(void*) {
  uint32_t lastWifiAttempt = millis(), lastAttempt = millis(), retryDelay = 0;
  // Persistent objects allow HTTP keep-alive; recreating them per packet forced
  // a new TCP/TLS handshake. Certificate verification remains enabled.
  WiFiClientSecure client;
  client.setCACert(TLS_ROOT_CA);
  HTTPClient http;
  http.setConnectTimeout(5000);
  http.setTimeout(7000);
  http.setReuse(true);
  bool httpReady = false;
  for (;;) {
    const uint32_t now = millis();
    if (WiFi.status() != WL_CONNECTED && now - lastWifiAttempt >= WIFI_RETRY_MS) {
      lastWifiAttempt = now;
      http.end(); client.stop(); httpReady = false;
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
    clockReady.store(time(nullptr) >= 1735689600);
    if (WiFi.status() == WL_CONNECTED && clockReady.load() && now - lastAttempt >= retryDelay) {
      asqac::Frame frames[asqac::BATCH_CAPACITY] = {};
      size_t count = 0;
      if (xSemaphoreTake(packetMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
        count = packetQueue.copyBatch(frames,asqac::BATCH_CAPACITY); xSemaphoreGive(packetMutex);
      }
      if (count) {
        const asqac::Frame& frame=frames[0];
        static char payload[15000]; // Static storage keeps task stack bounded.
        if (time(nullptr) - frame.recorded_at >= 86300) {
          acknowledgePacket(frame.sequence);
          rejectedUploads.fetch_add(1);
          Serial.println("ASQAC: expired queued packet discarded.");
          lastAttempt = millis(); retryDelay = 0;
        } else if (!asqac::encodeBatch(frames,count,DEVICE_UID,payload,sizeof(payload))) {
          Serial.println("ASQAC: batch encoding failed; retaining evidence for diagnosis.");
          lastAttempt=millis(); retryDelay=10000;
        } else {
          int status = -1;
          String response;
          const uint32_t requestStarted = millis();
          const uint32_t queuedMs = requestStarted - frame.captured_ms;
          if (!httpReady) httpReady = http.begin(client, TELEMETRY_URL);
          if (httpReady) {
            http.addHeader("Content-Type", "application/json");
            http.addHeader("x-device-token", DEVICE_TOKEN);
            status = http.POST((uint8_t*)payload, strlen(payload));
            if (status > 0) response = http.getString();
          }
          const uint32_t requestMs = millis() - requestStarted;
          if (status < 0 || status >= 500 || status == 401 || status == 403) {
            http.end(); client.stop(); httpReady = false;
          }
          lastHttpStatus.store(status);
          const bool accepted = status >= 200 && status < 300;
          const bool discard = status == 400 || status == 409 || status == 413;
          // 201 covers every row in the validated batch, including explicit
          // reviewed-transport rejections. Unknown failures keep the whole batch.
          if (accepted) for (size_t i=0;i<count;++i) acknowledgePacket(frames[i].sequence);
          if (discard) {
            Serial.println("ASQAC: rejected batch retained; check endpoint/schema configuration.");
          }
          if (accepted) {
            unsigned rejected=0;
            const char* cursor=response.c_str();
            while ((cursor=strstr(cursor,"\"rejected\":true"))) { ++rejected; ++cursor; }
            rejectedUploads.fetch_add(rejected);
            acceptedUploads.fetch_add(count-rejected);
            Serial.printf("ASQAC HTTPS %d: batch=%u | oldest_wait=%lums http=%lums newest_total=%lums pending=%u rejected=%u\n", status,
              (unsigned)count, (unsigned long)queuedMs, (unsigned long)requestMs,
              (unsigned long)(millis()-frames[count-1].captured_ms),
              (unsigned)queuedPackets(),rejected);
          } else {
            Serial.printf("ASQAC HTTPS %d: %s; %s\n", status,
              discard ? "batch rejected; retained" : "will retry",
              response.substring(0, 200).c_str());
          }
          lastAttempt = millis();
          // Keep at least 800 ms after the response, even after a slow TLS
          // handshake. Batch draining handles the samples produced meanwhile.
          retryDelay = accepted ? asqac::uploadWait(requestMs, status) :
            status == 429 ? 1500 : (status == 401 || status == 403) ? 60000 : 10000;
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

// ================= WI-FI =================
void startWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.println("ASQAC: joining Wi-Fi and waiting for UTC; sampling continues while connecting.");
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\nASQAC: single-file ESP32 cloud telemetry");
  if (!asqac::validUid(DEVICE_UID) || strlen(DEVICE_TOKEN) < 32 ||
      strncmp(TELEMETRY_URL, "https://", 8) != 0 ||
      strstr(TLS_ROOT_CA, "REPLACE_")) {
    Serial.println("Check the device/backend configuration at the top of this sketch.");
    while (true) delay(1000);
  }
  packetMutex = xSemaphoreCreateMutex();
  if (!packetMutex) { Serial.println("Queue mutex unavailable."); while (true) delay(1000); }
  if (!Wire1.begin(MPU_SDA, MPU_SCL, 400000)) Serial.println("MPU I2C bus failed to initialise.");
  Wire1.setTimeOut(50);
  bhOK = bhStart();
  bmpOK = bmpStart();
  if (bmpOK) bmpOK = bmpReference();
  mpuOK = mpuStart();
  if (mpuOK) {
    Serial.println("Keep capsule still: calibrating MPU6050...");
    mpuOK = mpuCalibrate();
  }
  Serial.printf("BH1750=%s BMP280=%s MPU6050=%s\n",
    bhOK ? "OK" : "retrying", bmpOK ? "OK" : "retrying", mpuOK ? "OK" : "retrying");
  startWiFi();
  if (xTaskCreate(uploadTask, "asqac-upload", 12288, nullptr, 1, nullptr) != pdPASS) {
    Serial.println("Cloud upload task could not start; reboot after checking free memory.");
    while (true) delay(1000);
  }
  lastMicros = micros();
  peaks.reset();
  lastPacket = millis();
}

// ================= LOOP =================
void loop() {
  const uint32_t nowMs = millis();
  // 125 Hz matches the original MPU6050 sample-rate register configuration.
  if (mpuOK && nowMs - lastImu >= 8) {
    lastImu = nowMs;
    if (mpuReadAll()) {
      const uint32_t now = micros();
      float dt = (uint32_t)(now - lastMicros) / 1e6f;
      lastMicros = now;
      if (dt > 0.5f) { dt = 0.008f; peaks.healthy = false; }
      const float axG = raw[0] / ACCEL_LSB_PER_G;
      const float ayG = raw[1] / ACCEL_LSB_PER_G;
      const float azG = raw[2] / ACCEL_LSB_PER_G;
      axMs2 = axG * G_TO_MS2; ayMs2 = ayG * G_TO_MS2; azMs2 = azG * G_TO_MS2;
      gx = (raw[4] - gyroBiasX) / GYRO_LSB_PER_DPS;
      gy = (raw[5] - gyroBiasY) / GYRO_LSB_PER_DPS;
      gz = (raw[6] - gyroBiasZ) / GYRO_LSB_PER_DPS;
      const float accRoll = atan2(ayG, azG) * RAD2DEG;
      const float accPitch = atan2(-axG, sqrt(ayG * ayG + azG * azG)) * RAD2DEG;
      roll = asqac::blendAngle(roll + gx * dt, accRoll, 0.02);
      pitch = asqac::blendAngle(pitch + gy * dt, accPitch, 0.02);
      peaks.observeMotion(axG, ayG, azG);
      lastMotionMs = millis();
    } else { mpuOK = false; peaks.healthy = false; }
  }
  if (nowMs - lastSlow >= 150) {
    lastSlow = nowMs;
    if (bhOK) {
      bhOK = bhRead(lux) && isfinite(lux) && lux >= 0;
      if (bhOK) { lastLightMs = millis(); peaks.observeLight(lux); }
      else peaks.healthy = false;
    }
    if (bmpOK) {
      float nextTemperature, nextPressure;
      bmpOK = bmpRead(nextTemperature, nextPressure);
      if (bmpOK) {
        tempC_bmp = nextTemperature; pressHpa = nextPressure;
        lastEnvironmentMs = millis();
        if (clockReady.load() && millis()>=5000) heightReference.observe(pressHpa,time(nullptr));
      }
      else peaks.healthy = false;
    }
  }
  if ((!bhOK || !bmpOK || !mpuOK) && nowMs - lastRetry >= 2000) {
    lastRetry = nowMs;
    peaks.healthy = false; // recovery/calibration gaps are not complete packets
    if (!bhOK) bhOK = bhStart();
    if (!bmpOK) { bmpOK = bmpStart(); if (bmpOK) bmpOK = bmpReference(); }
    if (!mpuOK) {
      mpuOK = mpuStart();
      if (mpuOK) {
        Serial.println("MPU reconnect: keep capsule still for calibration.");
        mpuOK = mpuCalibrate();
      }
    }
  }
  if (millis() - lastPacket >= PACKET_MS) {
    lastPacket = millis(); captureCloudPacket();
  }
  if (millis() - lastSerial >= 1000) {
    lastSerial = millis();
    Serial.printf("Sensors BH=%s BMP=%s MPU=%s | Lux %.1f T %.1fC P %.1fhPa | Roll %.1f Pitch %.1f | Cloud HTTP %d accepted %lu queue %u UTC %s\n",
      bhOK ? "OK" : "OFF", bmpOK ? "OK" : "OFF", mpuOK ? "OK" : "OFF",
      lux, tempC_bmp, pressHpa, roll, pitch, lastHttpStatus.load(),
      (unsigned long)acceptedUploads.load(), (unsigned)queuedPackets(), clockReady.load() ? "OK" : "waiting");
    if (bmpOK && lastEnvironmentMs) {
    Serial.printf("Barometric altitude estimate %.1fm (P0 %.2fhPa) | ",
      asqac::pressureAltitude(pressHpa,SEA_LEVEL_PRESSURE_HPA),SEA_LEVEL_PRESSURE_HPA);
    if (heightReference.recorded_at) Serial.printf("Height change %+.1fm from startup baseline %.2fhPa\n",
      asqac::pressureAltitude(pressHpa,heightReference.pressure),heightReference.pressure);
    else Serial.println("Height baseline calibrating: keep capsule still.");
    } else Serial.println("Barometric estimates waiting for valid pressure.");
  }
  delay(1);
}
