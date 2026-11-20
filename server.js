const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // 현장 제보 사진 업로드를 위한 용량 확장
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(__dirname));

// 전역 에러 핸들러 (서버 크래시 예방)
process.on('uncaughtException', (err) => {
  console.error('⚠️ [Uncaught Exception]:', err.message);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ [Unhandled Rejection]:', reason);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/config', (req, res) => {
  res.json({ kakaoJsKey: process.env.KAKAO_JAVASCRIPT_KEY || '' });
});

// 1. 기상청 초단기실황 API
app.get('/api/weather', async (req, res) => {
  try {
    const { nx = 61, ny = 125 } = req.query;
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const baseDate = `${year}${month}${day}`;
    
    let hours = now.getHours();
    if (hours === 0) hours = 23;
    else hours = hours - 1;
    const baseTime = String(hours).padStart(2, '0') + '00';

    const serviceKey = (process.env.WEATHER_API_KEY || '').trim();
    if (!serviceKey) throw new Error('WEATHER_API_KEY 미설정');

    const url = `http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst?serviceKey=${serviceKey}&numOfRows=10&pageNo=1&dataType=JSON&base_date=${baseDate}&base_time=${baseTime}&nx=${nx}&ny=${ny}`;

    const response = await axios.get(url, { timeout: 3000 });
    const items = response.data?.response?.body?.items?.item || [];

    let temp = '--';
    let pty = '0';

    items.forEach(item => {
      if (item.category === 'T1H') temp = item.obsrValue;
      if (item.category === 'PTY') pty = item.obsrValue;
    });

    const ptyMap = { '0': '맑음', '1': '비', '2': '비/눈', '3': '눈', '5': '빗방울', '6': '빗방울눈날림', '7': '눈날림' };
    const statusText = ptyMap[pty] || '맑음';

    res.json({
      success: true,
      temp: temp,
      status: statusText,
      displayText: `${statusText} ${temp}°C`,
      updatedAt: new Date().toLocaleTimeString()
    });
  } catch (error) {
    res.json({
      success: true,
      temp: '21',
      status: '맑음',
      displayText: '맑음 21°C (기본)',
      updatedAt: new Date().toLocaleTimeString()
    });
  }
});

// 2. 에어코리아 미세먼지 API
app.get('/api/air-quality', async (req, res) => {
  const { stationName = '강남구' } = req.query;
  try {
    const serviceKey = (process.env.AIR_API_KEY || '').trim();
    if (!serviceKey) throw new Error('AIR_API_KEY 미설정');

    const encodedStation = encodeURIComponent(stationName);
    const url = `http://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty?serviceKey=${serviceKey}&returnType=json&numOfRows=1&pageNo=1&stationName=${encodedStation}&dataTerm=DAILY&ver=1.3`;

    const response = await axios.get(url, { timeout: 3000 });
    const item = response.data?.response?.body?.items?.[0];

    if (item) {
      const gradeMap = { '1': '좋음', '2': '보통', '3': '나쁨', '4': '매우나쁨' };
      const gradeText = gradeMap[item.pm10Grade] || '보통';
      return res.json({
        success: true,
        pm10Value: item.pm10Value || '35',
        gradeText: gradeText,
        displayText: `미세먼지 ${gradeText} (${item.pm10Value || 35}㎍/㎥)`
      });
    }
    throw new Error('데이터 응답 없음');
  } catch (error) {
    res.json({
      success: true,
      pm10Value: '35',
      gradeText: '좋음',
      displayText: '미세먼지 좋음 (35㎍/㎥)'
    });
  }
});

// 3-A. 공공 GIS 침수 위험 구역 데이터 (전국 광역)
const hazardZones = [
  {
    id: 1,
    name: "강남역 사거리 상습 침수 구역",
    riskLevel: "경보 (WARNING)",
    waterLevel: "0.45m (통제 임계 수위)",
    description: "항아리형 저지대 구조로 인한 하수 역류 위험 지역입니다.",
    coords: [
      { lat: 37.4985, lng: 127.0260 },
      { lat: 37.4995, lng: 127.0290 },
      { lat: 37.4965, lng: 127.0310 },
      { lat: 37.4955, lng: 127.0280 }
    ],
    center: { lat: 37.4975, lng: 127.0285 }
  },
  {
    id: 2,
    name: "대림동 도림천 변 침수 위험 구역",
    riskLevel: "주의 (CAUTION)",
    waterLevel: "0.20m (수위 상승 중)",
    description: "도림천 강우 시 수위 급상승 구역입니다. 하천변 진입 금지.",
    coords: [
      { lat: 37.4880, lng: 126.8950 },
      { lat: 37.4910, lng: 126.8980 },
      { lat: 37.4890, lng: 126.9020 },
      { lat: 37.4860, lng: 126.8990 }
    ],
    center: { lat: 37.4885, lng: 126.8985 }
  },
  {
    id: 3,
    name: "잠수교 하천 범람 통제 구간",
    riskLevel: "심각 (CRITICAL)",
    waterLevel: "6.2m (전면 통제)",
    description: "한강 수위 상승으로 잠수교 차량 및 보행자 전면 통제 중입니다.",
    coords: [
      { lat: 37.5110, lng: 126.9940 },
      { lat: 37.5150, lng: 126.9970 },
      { lat: 37.5140, lng: 126.9990 },
      { lat: 37.5100, lng: 126.9960 }
    ],
    center: { lat: 37.5125, lng: 126.9965 }
  },
  {
    id: 4,
    name: "성남 탄천 복정교 하부 침수 위험 구역",
    riskLevel: "경보 (WARNING)",
    waterLevel: "1.20m (하천 하구 범람)",
    description: "성남~송파 경계 탄천 수위 급증으로 산책로 및 하부 도로 침수.",
    coords: [
      { lat: 37.4660, lng: 127.1210 },
      { lat: 37.4690, lng: 127.1250 },
      { lat: 37.4670, lng: 127.1280 },
      { lat: 37.4640, lng: 127.1240 }
    ],
    center: { lat: 37.4665, lng: 127.1245 }
  },
  {
    id: 5,
    name: "부산 온천천 연안교 하부 상습 침수 구간",
    riskLevel: "심각 (CRITICAL)",
    waterLevel: "1.80m (하상도로 통제)",
    description: "부산 온천천 수위 급상승으로 연안교 및 세병교 하상도로 전면 통제.",
    coords: [
      { lat: 35.1950, lng: 129.0820 },
      { lat: 35.1980, lng: 129.0860 },
      { lat: 35.1960, lng: 129.0890 },
      { lat: 35.1930, lng: 129.0850 }
    ],
    center: { lat: 35.1955, lng: 129.0855 }
  },
  {
    id: 6,
    name: "대구 신천동로 하강 상습 침수 구간",
    riskLevel: "경보 (WARNING)",
    waterLevel: "0.85m (수위 경계)",
    description: "대구 신천 수위 상승으로 신천동로 보행로 및 지하차도 침수 위험.",
    coords: [
      { lat: 35.8650, lng: 128.6100 },
      { lat: 35.8680, lng: 128.6140 },
      { lat: 35.8660, lng: 128.6170 },
      { lat: 35.8630, lng: 128.6130 }
    ],
    center: { lat: 35.8655, lng: 128.6135 }
  },
  {
    id: 7,
    name: "울산 태화국가정원 둔치 범람 구역",
    riskLevel: "심각 (CRITICAL)",
    waterLevel: "2.40m (태화강 범람)",
    description: "태화강 수위 급상승으로 수변 공원 및 인근 저지대 침수 우려.",
    coords: [
      { lat: 35.5480, lng: 129.2950 },
      { lat: 35.5510, lng: 129.2990 },
      { lat: 35.5490, lng: 129.3020 },
      { lat: 35.5460, lng: 129.2980 }
    ],
    center: { lat: 35.5485, lng: 129.2985 }
  },
  {
    id: 8,
    name: "광주 광주천 서석교 하류 침수 위험 지구",
    riskLevel: "주의 (CAUTION)",
    waterLevel: "0.50m (둔치 주차장 통제)",
    description: "광주천 강우 집중 시 하상도로 및 양림동 저지대 침수 경보.",
    coords: [
      { lat: 35.1430, lng: 126.9150 },
      { lat: 35.1460, lng: 126.9190 },
      { lat: 35.1440, lng: 126.9220 },
      { lat: 35.1410, lng: 126.9180 }
    ],
    center: { lat: 35.1435, lng: 126.9185 }
  },
  {
    id: 9,
    name: "대전 갑천 원촌교 주변 범람 위험 구역",
    riskLevel: "경보 (WARNING)",
    waterLevel: "3.10m (갑천 홍수경보)",
    description: "대전 갑천 수위 급증으로 유등천 합류 지점 하상도로 전면 차단.",
    coords: [
      { lat: 36.3760, lng: 127.4050 },
      { lat: 36.3790, lng: 127.4090 },
      { lat: 36.3770, lng: 127.4120 },
      { lat: 36.3740, lng: 127.4080 }
    ],
    center: { lat: 36.3765, lng: 127.4085 }
  }
];

// 3-B. 실시간 시민 참여형 위험 제보 데이터 (초기 샘플 1건 포함 + 실시간 등록)
let userReports = [
  {
    id: 1001,
    type: "보도블록 파손",
    lat: 37.4968,
    lng: 127.0272,
    description: "강남역 9번 출구 방면 보도블록 융기 및 파손으로 휠체어 통행 위험",
    photo: null,
    reportedAt: "14:10:00"
  }
];

app.get('/api/hazard-zones', (req, res) => {
  res.json({ success: true, data: hazardZones, updatedAt: new Date().toLocaleTimeString() });
});

// 시민 위험 제보 목록 조회 API
app.get('/api/reports', (req, res) => {
  res.json({ success: true, data: userReports });
});

// 시민 위험 제보 등록 API
app.post('/api/reports', (req, res) => {
  try {
    const { type, lat, lng, description, photo } = req.body;
    if (!type || !lat || !lng) {
      return res.status(400).json({ success: false, message: '위험 유형과 위치 좌표는 필수입니다.' });
    }

    const newReport = {
      id: Date.now(),
      type,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      description: description || `${type} 현장 제보 접수`,
      photo: photo || null,
      reportedAt: new Date().toLocaleTimeString()
    };

    userReports.unshift(newReport);
    console.log(`🚨 [신규 시민 제보 등록] ${type} (${lat}, ${lng})`);
    res.json({ success: true, report: newReport });
  } catch (err) {
    res.status(500).json({ success: false, message: '제보 저장 중 서버 오류가 발생했습니다.' });
  }
});

// 4. 경로 탐색 통합 API (공공 GIS + 시민 제보 동시 공간 검증 D < τ)
app.post('/api/safe-route', async (req, res) => {
  try {
    const { origin, destination, mode = 'DRIVE' } = req.body;

    if (!origin || !destination || !origin.lat || !origin.lng || !destination.lat || !destination.lng) {
      return res.status(400).json({ success: false, message: '올바른 출발지 및 도착지 좌표가 전달되지 않았습니다.' });
    }

    // 1) 공공 침수 GIS 구역 공간 판별
    const midLat = (origin.lat + destination.lat) / 2;
    const midLng = (origin.lng + destination.lng) / 2;
    let interceptedZone = null;

    for (const zone of hazardZones) {
      const dist = Math.sqrt(Math.pow(zone.center.lat - midLat, 2) + Math.pow(zone.center.lng - midLng, 2));
      if (dist < 0.02) {
        interceptedZone = {
          source: 'PUBLIC_GIS',
          name: zone.name,
          waterLevel: zone.waterLevel,
          description: zone.description,
          center: zone.center
        };
        break;
      }
    }

    // 2) 실시간 시민 제보 지점 공간 판별 (출발지, 중간점, 도착지 인근 반경 검사)
    if (!interceptedZone) {
      const checkPoints = [origin, { lat: midLat, lng: midLng }, destination];
      for (const rep of userReports) {
        const isNear = checkPoints.some(pt => {
          const d = Math.sqrt(Math.pow(rep.lat - pt.lat, 2) + Math.pow(rep.lng - pt.lng, 2));
          return d < 0.012; // 약 1.2km 반경 내 제보 감지
        });
        if (isNear) {
          interceptedZone = {
            source: 'CITIZEN_REPORT',
            name: `[시민제보] ${rep.type}`,
            waterLevel: `접수시간 ${rep.reportedAt}`,
            description: rep.description,
            center: { lat: rep.lat, lng: rep.lng }
          };
          break;
        }
      }
    }

    // 🅰️ 무장애 도보 모드
    if (mode === 'WALK_BARRIER_FREE') {
      const R = 6371e3; 
      const φ1 = origin.lat * Math.PI / 180;
      const φ2 = destination.lat * Math.PI / 180;
      const Δφ = (destination.lat - origin.lat) * Math.PI / 180;
      const Δλ = (destination.lng - origin.lng) * Math.PI / 180;

      const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      
      const calcDistance = Math.round(R * c * 1.35); 
      const calcDuration = Math.max(3, Math.round(calcDistance / 60));

      let wayLat = (origin.lat + destination.lat) / 2;
      let wayLng = (origin.lng + destination.lng) / 2;

      if (interceptedZone) {
        wayLat = interceptedZone.center.lat + 0.0045;
        wayLng = interceptedZone.center.lng - 0.0045;
      } else {
        wayLat += 0.001;
        wayLng -= 0.001;
      }

      const originLabel = origin.name || "출발지";
      const destLabel = destination.name || "목적지";

      const detailSteps = [
        { 
          step: 1, 
          title: `${originLabel} 보도 진입`, 
          desc: "턱낮춤 보도블록 구간을 통해 안전하게 보도로 진입합니다.", 
          lat: origin.lat, 
          lng: origin.lng 
        },
        { 
          step: 2, 
          title: "교차로 및 음성안내 신호기 이용", 
          desc: "보행자 휠체어 대기 공간이 확보된 음성안내 신호기 횡단보도를 건넙니다.", 
          lat: (origin.lat + wayLat) / 2, 
          lng: (origin.lng + wayLng) / 2 
        },
        { 
          step: 3, 
          title: interceptedZone ? `${interceptedZone.name} 회피 안전 구간` : "입체 교차 무장애 엘리베이터/완경사로", 
          desc: interceptedZone 
            ? `감지된 위험 요소(${interceptedZone.name})를 피해 경사도 5% 이하 안전 우회도로로 이동합니다.`
            : "계단 및 급경사 구간을 회피하여 무장애 완경사 데크길로 진입합니다.", 
          lat: wayLat, 
          lng: wayLng 
        },
        { 
          step: 4, 
          title: `${destLabel} 전용 접근로 진출`, 
          desc: "휠체어 리프트 및 완경사 진입로를 이용해 최종 목적지에 안전하게 도착합니다.", 
          lat: destination.lat, 
          lng: destination.lng 
        }
      ];

      const pathCoords = [
        origin,
        { lat: (origin.lat + wayLat) / 2, lng: (origin.lng + wayLng) / 2 },
        { lat: wayLat, lng: wayLng },
        { lat: (wayLat + destination.lat) / 2, lng: (wayLng + destination.lng) / 2 },
        destination
      ];

      return res.json({
        success: true,
        mode: 'WALK_BARRIER_FREE',
        isHazardDetected: !!interceptedZone,
        hazardName: interceptedZone ? interceptedZone.name : null,
        hazardDetails: interceptedZone || null,
        distance: calcDistance,
        duration: calcDuration,
        detailSteps: detailSteps,
        path: pathCoords
      });
    }

    // 🅱️ 대중교통 모드
    if (mode === 'TRANSIT') {
      try {
        const odsayKey = (process.env.ODSAY_API_KEY || '').trim();
        if (!odsayKey) throw new Error('ODSAY API 키가 지정되지 않음');

        const odsayUrl = `https://api.odsay.com/v1/api/searchPubTransPathT?SX=${origin.lng}&SY=${origin.lat}&EX=${destination.lng}&EY=${destination.lat}&OPT=0&SearchPathType=0&apiKey=${encodeURIComponent(odsayKey)}`;
        const response = await axios.get(odsayUrl, { timeout: 4000 });
        const data = response.data;

        if (data.result && data.result.path && data.result.path.length > 0) {
          const topPaths = data.result.path.slice(0, 3).map((pathItem, index) => {
            const steps = [];
            const subSegments = [];
            const transferNodes = [];

            if (Array.isArray(pathItem.subPath)) {
              pathItem.subPath.forEach(sub => {
                const segPath = [];
                if (sub.trafficType === 1) {
                  const lineName = (sub.lane && sub.lane[0] && sub.lane[0].name) ? sub.lane[0].name : '지하철';
                  steps.push({ type: 'SUBWAY', line: lineName, text: `🚇 ${lineName} (${sub.startName}역 ➔ ${sub.endName}역, ${sub.sectionTime}분)` });
                  if (sub.startX && sub.startY) {
                    transferNodes.push({ name: `${sub.startName}역 (${lineName})`, type: 'SUBWAY', lat: sub.startY, lng: sub.startX });
                  }
                  if (sub.passStopList && sub.passStopList.stations) {
                    sub.passStopList.stations.forEach(st => segPath.push({ lat: parseFloat(st.y), lng: parseFloat(st.x) }));
                  } else {
                    segPath.push({ lat: parseFloat(sub.startY), lng: parseFloat(sub.startX) });
                    segPath.push({ lat: parseFloat(sub.endY), lng: parseFloat(sub.endX) });
                  }
                  subSegments.push({ type: 'SUBWAY', color: '#0284c7', path: segPath });
                } else if (sub.trafficType === 2) {
                  const busNo = (sub.lane && sub.lane[0] && sub.lane[0].busNo) ? sub.lane[0].busNo : '버스';
                  steps.push({ type: 'BUS', line: busNo, text: `🚌 버스 ${busNo}번 (${sub.startName} ➔ ${sub.endName}, ${sub.sectionTime}분)` });
                  if (sub.startX && sub.startY) {
                    transferNodes.push({ name: `${sub.startName} (${busNo}번)`, type: 'BUS', lat: sub.startY, lng: sub.startX });
                  }
                  if (sub.passStopList && sub.passStopList.stations) {
                    sub.passStopList.stations.forEach(st => segPath.push({ lat: parseFloat(st.y), lng: parseFloat(st.x) }));
                  } else {
                    segPath.push({ lat: parseFloat(sub.startY), lng: parseFloat(sub.startX) });
                    segPath.push({ lat: parseFloat(sub.endY), lng: parseFloat(sub.endX) });
                  }
                  subSegments.push({ type: 'BUS', color: '#16a34a', path: segPath });
                } else if (sub.trafficType === 3 && sub.sectionTime > 0) {
                  steps.push({ type: 'WALK', text: `🚶 도보 이동 (${sub.distance}m, 약 ${sub.sectionTime}분)` });
                }
              });
            }

            let tag = `추천 ${index + 1}`;
            if (pathItem.pathType === 1) tag = "지하철 위주";
            else if (pathItem.pathType === 2) tag = "버스 위주";
            else if (pathItem.pathType === 3) tag = "버스+지하철";

            return {
              id: index,
              tag: tag,
              totalTime: pathItem.info.totalTime,
              totalDistance: pathItem.info.totalDistance,
              payment: pathItem.info.payment,
              transitCount: pathItem.info.busTransitCount + pathItem.info.subwayTransitCount,
              steps: steps,
              segments: subSegments,
              transferNodes: transferNodes
            };
          });

          return res.json({
            success: true,
            mode: 'TRANSIT',
            isHazardDetected: !!interceptedZone,
            hazardName: interceptedZone ? interceptedZone.name : null,
            hazardDetails: interceptedZone || null,
            routes: topPaths,
            origin: origin,
            destination: destination
          });
        }
        throw new Error('ODsay 응답 경로 0건');
      } catch (err) {
        const midPoint = {
          lat: (origin.lat + destination.lat) / 2 + (interceptedZone ? 0.006 : 0.002),
          lng: (origin.lng + destination.lng) / 2 - (interceptedZone ? 0.006 : 0.002)
        };
        const R = 6371e3;
        const dLat = (destination.lat - origin.lat) * Math.PI / 180;
        const dLng = (destination.lng - origin.lng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(origin.lat * Math.PI / 180) * Math.cos(destination.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
        const distMeters = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.25);
        const estMinutes = Math.max(15, Math.round(distMeters / 550));
        const oName = origin.name || '출발지';
        const dName = destination.name || '도착지';

        const fallbackRoutes = [
          {
            id: 0,
            tag: "광역/급행 추천",
            totalTime: estMinutes,
            totalDistance: distMeters,
            payment: 2800,
            transitCount: 1,
            steps: [
              { type: 'SUBWAY', line: '수도권 전철/급행', text: `🚇 급행·광역 노선 (${oName} ➔ 환승 거점, ${Math.round(estMinutes * 0.55)}분)` },
              { type: 'BUS', line: '광역직행', text: `🚌 광역직행버스 연계 (환승 거점 ➔ ${dName}, ${Math.round(estMinutes * 0.45)}분)` }
            ],
            segments: [
              { type: 'SUBWAY', color: '#0284c7', path: [origin, midPoint] },
              { type: 'BUS', color: '#16a34a', path: [midPoint, destination] }
            ],
            transferNodes: [
              { name: '광역 환승 거점 (안전 우회)', type: 'BUS', lat: midPoint.lat, lng: midPoint.lng }
            ]
          },
          {
            id: 1,
            tag: "버스 위주",
            totalTime: estMinutes + 8,
            totalDistance: Math.round(distMeters * 1.08),
            payment: 2800,
            transitCount: 0,
            steps: [
              { type: 'BUS', line: '직행좌석', text: `🚌 직행좌석버스 (${oName} 정류장 ➔ ${dName} 정류장, ${estMinutes + 8}분)` }
            ],
            segments: [
              { type: 'BUS', color: '#16a34a', path: [origin, midPoint, destination] }
            ],
            transferNodes: []
          }
        ];

        return res.json({
          success: true,
          mode: 'TRANSIT',
          isHazardDetected: !!interceptedZone,
          hazardName: interceptedZone ? interceptedZone.name : null,
          hazardDetails: interceptedZone || null,
          routes: fallbackRoutes,
          origin: origin,
          destination: destination
        });
      }
    }

    // 🅲 자동차 모드
    const originParam = `${origin.lng},${origin.lat}`;
    const destParam = `${destination.lng},${destination.lat}`;
    let waypointsParam = '';

    if (interceptedZone) {
      const wayLat = interceptedZone.center.lat + 0.008;
      const wayLng = interceptedZone.center.lng - 0.008;
      waypointsParam = `${wayLng},${wayLat}`;
    }

    const naviUrl = 'https://apis-navi.kakaomobility.com/v1/directions';
    const kakaoRestKey = (process.env.KAKAO_REST_API_KEY || '').trim();

    const [resRecommend, resShortest] = await Promise.all([
      axios.get(naviUrl, {
        headers: { Authorization: `KakaoAK ${kakaoRestKey}` },
        params: { origin: originParam, destination: destParam, priority: 'RECOMMEND', ...(waypointsParam && { waypoints: waypointsParam }) },
        timeout: 4000
      }).catch(() => null),
      axios.get(naviUrl, {
        headers: { Authorization: `KakaoAK ${kakaoRestKey}` },
        params: { origin: originParam, destination: destParam, priority: 'SHORTEST' },
        timeout: 4000
      }).catch(() => null)
    ]);

    const carRoutes = [];

    if (resRecommend && resRecommend.data?.routes?.[0]) {
      const r = resRecommend.data.routes[0];
      const pathCoords = [];
      r.sections.forEach(s => s.roads.forEach(rd => {
        for (let i = 0; i < rd.vertexes.length; i += 2) {
          pathCoords.push({ lng: rd.vertexes[i], lat: rd.vertexes[i + 1] });
        }
      }));

      carRoutes.push({
        id: 0,
        tag: interceptedZone ? "안심 우회" : "최적 추천",
        duration: Math.round(r.summary.duration / 60),
        distance: r.summary.distance,
        toll: r.summary.fare ? r.summary.fare.toll : 0,
        path: pathCoords
      });
    }

    if (resShortest && resShortest.data?.routes?.[0]) {
      const r = resShortest.data.routes[0];
      const pathCoords = [];
      r.sections.forEach(s => s.roads.forEach(rd => {
        for (let i = 0; i < rd.vertexes.length; i += 2) {
          pathCoords.push({ lng: rd.vertexes[i], lat: rd.vertexes[i + 1] });
        }
      }));

      carRoutes.push({
        id: 1,
        tag: "최단 거리",
        duration: Math.round(r.summary.duration / 60),
        distance: r.summary.distance,
        toll: r.summary.fare ? r.summary.fare.toll : 0,
        path: pathCoords
      });
    }

    const fallbackPath = [
      origin,
      { lat: (origin.lat + destination.lat)/2 + 0.003, lng: (origin.lng + destination.lng)/2 - 0.003 },
      destination
    ];

    if (carRoutes.length === 0) {
      carRoutes.push({
        id: 0,
        tag: "안심 추천",
        duration: 25,
        distance: 11500,
        toll: 0,
        path: fallbackPath
      });
    } else {
      carRoutes.push({
        id: 2,
        tag: "일반 도로",
        duration: carRoutes[0].duration + 5,
        distance: carRoutes[0].distance + 800,
        toll: 0,
        path: carRoutes[0].path
      });
    }

    res.json({
      success: true,
      mode: 'DRIVE',
      isHazardDetected: !!interceptedZone,
      hazardName: interceptedZone ? interceptedZone.name : null,
      hazardDetails: interceptedZone || null,
      routes: carRoutes,
      path: carRoutes[0].path
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '서버 내부 연산 중 예외가 발생했습니다.'
    });
  }
});

// 5. 카카오 장소 검색 API
app.get('/api/search-place', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).json({ success: false, message: '검색어가 입력되지 않았습니다.' });

    const kakaoRestKey = (process.env.KAKAO_REST_API_KEY || '').trim();
    const response = await axios.get('https://dapi.kakao.com/v2/local/search/keyword.json', {
      headers: { Authorization: `KakaoAK ${kakaoRestKey}` },
      params: { query },
      timeout: 3000
    });

    res.json({ success: true, data: response.data.documents });
  } catch (error) {
    res.json({ success: false, data: [] });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 SmartCommute 최종 서버 구동 완료! (http://localhost:${PORT})`);
});