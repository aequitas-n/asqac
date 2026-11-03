/* ASQAC — ESP32-C3 Super Mini, Arduino ESP32 core 3.x
 * Libraries: Adafruit MPU6050, Adafruit BMP280, Adafruit Unified Sensor,
 * Adafruit BusIO, BH1750 by Christopher Laws, ArduinoJson 7.
 * Wire SDA=9 SCL=8. External 4.7k pull-ups to 3.3V; common ground.
 * Peak acceleration is total magnitude (includes gravity); no invented sensors.
 */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_BMP280.h>
#include <Adafruit_Sensor.h>
#include <BH1750.h>
#include <ArduinoJson.h>
#include <time.h>
#include <math.h>
#include <atomic>
#include "secrets.h"

Adafruit_MPU6050 imu;
Adafruit_BMP280 bmp;
BH1750 light;
constexpr uint32_t SAMPLE_MS=20, PACKET_MS=10000, WIFI_RETRY_MS=15000;
constexpr size_t QUEUE_SIZE=90; // 15 minutes at 10 seconds; volatile bounded RAM.
String packets[QUEUE_SIZE];
size_t queueHead=0,queueCount=0;
float peakG=1,ax=0,ay=0,az=1,gx=0,gy=0,gz=0;
float pitch=0,roll=0,lastLux=-1,lightPeak=-1;
bool sensorsReady=false,sampleHealthy=false,lightHealthy=false;
std::atomic<bool> clockReady{false};
uint32_t lastSample=0,lastLight=0,lastPacket=0,lastWifi=0,nextPost=0,dropped=0;

void queuePacket(const String& packet) {
  if(queueCount==QUEUE_SIZE){packets[queueHead]="";queueHead=(queueHead+1)%QUEUE_SIZE;queueCount--;dropped++;Serial.printf("Queue overflow: %lu readings dropped\n",(unsigned long)dropped);}
  packets[(queueHead+queueCount)%QUEUE_SIZE]=packet;queueCount++;
}
void popPacket(){packets[queueHead]="";queueHead=(queueHead+1)%QUEUE_SIZE;queueCount--;}
void connectWifi(){lastWifi=millis();WiFi.disconnect();WiFi.begin(WIFI_SSID,WIFI_PASSWORD);Serial.println("Connecting Wi-Fi…");}
bool clockIsValid(){return time(nullptr)>1735689600;}
void sampleImu(){
  sensors_event_t accel,gyro,temp;
  sampleHealthy=imu.getEvent(&accel,&gyro,&temp);
  if(!sampleHealthy)return;
  ax=accel.acceleration.x/9.80665f;ay=accel.acceleration.y/9.80665f;az=accel.acceleration.z/9.80665f;
  gx=gyro.gyro.x*180.0f/PI;gy=gyro.gyro.y*180.0f/PI;gz=gyro.gyro.z*180.0f/PI;
  pitch=atan2f(-ax,sqrtf(ay*ay+az*az))*180.0f/PI;
  roll=atan2f(ay,az)*180.0f/PI;
  peakG=fmaxf(peakG,sqrtf(ax*ax+ay*ay+az*az));
}
void createPacket(){
  if(!clockReady||!sensorsReady||!sampleHealthy||!lightHealthy){Serial.println("Waiting for clock and all sensors; no fabricated readings sent.");return;}
  const float temperature=bmp.readTemperature(),pressure=bmp.readPressure()/100.0f;
  const float lux=fmaxf(lightPeak,lastLux);
  if(!isfinite(temperature)||!isfinite(pressure)||!isfinite(lux)||lux<0||pressure<300||pressure>1200||temperature< -40||temperature>85){Serial.println("Invalid sensor reading; packet skipped.");return;}
  time_t epoch=time(nullptr);struct tm utc;gmtime_r(&epoch,&utc);char stamp[28];strftime(stamp,sizeof(stamp),"%Y-%m-%dT%H:%M:%SZ",&utc);
  JsonDocument doc;doc["device_uid"]=DEVICE_UID;doc["recorded_at"]=stamp;doc["temp_c"]=temperature;doc["pressure_hpa"]=pressure;doc["lux"]=lux;
  doc["ax"]=ax;doc["ay"]=ay;doc["az"]=az;doc["gx"]=gx;doc["gy"]=gy;doc["gz"]=gz;doc["pitch_deg"]=pitch;doc["roll_deg"]=roll;doc["shock_g"]=peakG;doc["rssi"]=WiFi.status()==WL_CONNECTED?WiFi.RSSI():-127;doc["simulated"]=false;
  String body;serializeJson(doc,body);queuePacket(body);peakG=1.0f;lightPeak=lastLux;
}
// Network work runs on a separate FreeRTOS task even on the single-core C3.
// The loop keeps sampling IMU shocks while HTTPS waits. The bounded queue is
// shared only behind a mutex; copying a packet does not block 50 Hz sampling.
SemaphoreHandle_t packetMutex;
void networkTask(void*){
  for(;;){
    const uint32_t now=millis();
    if(WiFi.status()!=WL_CONNECTED&&now-lastWifi>=WIFI_RETRY_MS)connectWifi();
    clockReady=clockIsValid();
    if((int32_t)(now-nextPost)>=0&&WiFi.status()==WL_CONNECTED&&clockReady){
      String body;
      if(xSemaphoreTake(packetMutex,pdMS_TO_TICKS(20))==pdTRUE){if(queueCount)body=packets[queueHead];xSemaphoreGive(packetMutex);}
      if(body.length()){
        WiFiClientSecure tls;tls.setCACert(TLS_ROOT_CA);HTTPClient http;http.setConnectTimeout(4000);http.setTimeout(5000);
        int status=-1;
        if(http.begin(tls,TELEMETRY_URL)){http.addHeader("Content-Type","application/json");http.addHeader("x-device-token",DEVICE_TOKEN);status=http.POST(body);http.end();}
        const bool advance=(status>=200&&status<300)||status==400||status==409||status==413;
        if(advance&&xSemaphoreTake(packetMutex,pdMS_TO_TICKS(20))==pdTRUE){if(queueCount&&packets[queueHead]==body)popPacket();xSemaphoreGive(packetMutex);}
        if(status<200||status>=300)Serial.printf("HTTPS %d; retry/backlog policy applied\n",status);
        nextPost=millis()+((status==401||status==403)?60000:advance?2500:10000);
      }
    }
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}
void setup(){
  Serial.begin(115200);delay(500);Wire.begin(9,8);Wire.setClock(100000);
  const bool imuOk=imu.begin(0x68,&Wire);
  const bool bmpOk=bmp.begin(0x76)||bmp.begin(0x77);
  const bool luxOk=light.begin(BH1750::CONTINUOUS_HIGH_RES_MODE,0x23,&Wire)||light.begin(BH1750::CONTINUOUS_HIGH_RES_MODE,0x5c,&Wire);
  sensorsReady=imuOk&&bmpOk&&luxOk;
  Serial.printf("MPU6050=%s BMP280=%s BH1750=%s\n",imuOk?"OK":"FAIL",bmpOk?"OK":"FAIL",luxOk?"OK":"FAIL");
  if(imuOk){imu.setAccelerometerRange(MPU6050_RANGE_16_G);imu.setGyroRange(MPU6050_RANGE_500_DEG);imu.setFilterBandwidth(MPU6050_BAND_94_HZ);}
  WiFi.mode(WIFI_STA);WiFi.setAutoReconnect(true);WiFi.setSleep(false);connectWifi();
  configTime(0,0,"pool.ntp.org","time.nist.gov");
  packetMutex=xSemaphoreCreateMutex();
  if(!packetMutex){Serial.println("Queue mutex unavailable");while(true)delay(1000);}
  xTaskCreate(networkTask,"asqac-network",8192,nullptr,1,nullptr);
}
void loop(){
  const uint32_t now=millis();
  if(sensorsReady&&now-lastSample>=SAMPLE_MS){lastSample=now;sampleImu();}
  if(sensorsReady&&now-lastLight>=200){lastLight=now;const float reading=light.readLightLevel();lightHealthy=isfinite(reading)&&reading>=0;if(lightHealthy){lastLux=reading;lightPeak=fmaxf(lightPeak,reading);}}
  if(now-lastPacket>=PACKET_MS){lastPacket=now;if(xSemaphoreTake(packetMutex,pdMS_TO_TICKS(10))==pdTRUE){createPacket();xSemaphoreGive(packetMutex);}}
  delay(1);
}
