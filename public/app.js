// 스터디버디 프론트엔드 — 빌드 도구 없는 단일 페이지 앱 (hash 라우팅)

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');
const topbar = $('#topbar');
const tabbar = $('#tabbar');
// PC에서는 앱 화면(.phone) 안에서 스크롤되고, 휴대폰에서는 페이지 전체가 스크롤된다.
const scroller = () => {
  const phone = $('.phone');
  return getComputedStyle(phone).overflowY === 'auto' ? phone : document.scrollingElement;
};

const WD = ['', '월', '화', '수', '목', '금', '토', '일'];
const AVATARS = ['🙂', '😎', '🤓', '😺', '🐻', '🐰', '🦊', '🐼', '👩', '🧑', '👦', '👧', '👩‍🎓', '🧑‍💻', '🙋‍♀️', '🙋‍♂️', '🌱', '📚'];

// 선 아이콘: Phosphor Icons (regular), MIT License, Copyright (c) 2023 Phosphor Icons. 전문은 vendor/PHOSPHOR_LICENSE.txt
// 화면에 쓰는 것만 넣었다. 새 아이콘은 @phosphor-icons/core 의 assets/regular/<이름>.svg 에서 path 값을 복사한다.
const ICON_D = {
  'house': 'M219.31,108.68l-80-80a16,16,0,0,0-22.62,0l-80,80A15.87,15.87,0,0,0,32,120v96a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V160h32v56a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V120A15.87,15.87,0,0,0,219.31,108.68ZM208,208H160V152a8,8,0,0,0-8-8H104a8,8,0,0,0-8,8v56H48V120l80-80,80,80Z',
  'users': 'M117.25,157.92a60,60,0,1,0-66.5,0A95.83,95.83,0,0,0,3.53,195.63a8,8,0,1,0,13.4,8.74,80,80,0,0,1,134.14,0,8,8,0,0,0,13.4-8.74A95.83,95.83,0,0,0,117.25,157.92ZM40,108a44,44,0,1,1,44,44A44.05,44.05,0,0,1,40,108Zm210.14,98.7a8,8,0,0,1-11.07-2.33A79.83,79.83,0,0,0,172,168a8,8,0,0,1,0-16,44,44,0,1,0-16.34-84.87,8,8,0,1,1-5.94-14.85,60,60,0,0,1,55.53,105.64,95.83,95.83,0,0,1,47.22,37.71A8,8,0,0,1,250.14,206.7Z',
  'chat-circle': 'M128,24A104,104,0,0,0,36.18,176.88L24.83,210.93a16,16,0,0,0,20.24,20.24l34.05-11.35A104,104,0,1,0,128,24Zm0,192a87.87,87.87,0,0,1-44.06-11.81,8,8,0,0,0-6.54-.67L40,216,52.47,178.6a8,8,0,0,0-.66-6.54A88,88,0,1,1,128,216Z',
  'user': 'M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8c18.84-32.56,52.14-52,89.07-52s70.23,19.44,89.07,52a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z',
  'caret-left': 'M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z',
  'caret-right': 'M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z',
  'warning': 'M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM222.93,203.8a8.5,8.5,0,0,1-7.48,4.2H40.55a8.5,8.5,0,0,1-7.48-4.2,7.59,7.59,0,0,1,0-7.72L120.52,44.21a8.75,8.75,0,0,1,15,0l87.45,151.87A7.59,7.59,0,0,1,222.93,203.8ZM120,144V104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,180Z',
  'calendar-blank': 'M208,32H184V24a8,8,0,0,0-16,0v8H88V24a8,8,0,0,0-16,0v8H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM72,48v8a8,8,0,0,0,16,0V48h80v8a8,8,0,0,0,16,0V48h24V80H48V48ZM208,208H48V96H208V208Z',
  'check-circle': 'M173.66,98.34a8,8,0,0,1,0,11.32l-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35A8,8,0,0,1,173.66,98.34ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z',
  'check': 'M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z',
  'x': 'M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z',
  'chart-bar': 'M224,200h-8V40a8,8,0,0,0-8-8H152a8,8,0,0,0-8,8V80H96a8,8,0,0,0-8,8v40H48a8,8,0,0,0-8,8v64H32a8,8,0,0,0,0,16H224a8,8,0,0,0,0-16ZM160,48h40V200H160ZM104,96h40V200H104ZM56,144H88v56H56Z',
  'chart-line-up': 'M232,208a8,8,0,0,1-8,8H32a8,8,0,0,1-8-8V48a8,8,0,0,1,16,0V156.69l50.34-50.35a8,8,0,0,1,11.32,0L128,132.69,180.69,80H160a8,8,0,0,1,0-16h40a8,8,0,0,1,8,8v40a8,8,0,0,1-16,0V91.31l-58.34,58.35a8,8,0,0,1-11.32,0L96,123.31l-56,56V200H224A8,8,0,0,1,232,208Z',
  'hand-waving': 'M220.17,100,202.86,70a28,28,0,0,0-38.24-10.25,27.69,27.69,0,0,0-9,8.34L138.2,38a28,28,0,0,0-48.48,0A28,28,0,0,0,48.15,74l1.59,2.76A27.67,27.67,0,0,0,38,80.41a28,28,0,0,0-10.24,38.25l40,69.32a87.47,87.47,0,0,0,53.43,41,88.56,88.56,0,0,0,22.92,3,88,88,0,0,0,76.06-132Zm-6.66,62.64A72,72,0,0,1,81.62,180l-40-69.32a12,12,0,0,1,20.78-12L81.63,132a8,8,0,1,0,13.85-8L62,66A12,12,0,1,1,82.78,54L114,108a8,8,0,1,0,13.85-8L103.57,58h0a12,12,0,1,1,20.78-12l33.42,57.9a48,48,0,0,0-5.54,60.6,8,8,0,0,0,13.24-9A32,32,0,0,1,172.78,112a8,8,0,0,0,2.13-10.4L168.23,90A12,12,0,1,1,189,78l17.31,30A71.56,71.56,0,0,1,213.51,162.62ZM184.25,31.71A8,8,0,0,1,194,26a59.62,59.62,0,0,1,36.53,28l.33.57a8,8,0,1,1-13.85,8l-.33-.57a43.67,43.67,0,0,0-26.8-20.5A8,8,0,0,1,184.25,31.71ZM80.89,237a8,8,0,0,1-11.23,1.33A119.56,119.56,0,0,1,40.06,204a8,8,0,0,1,13.86-8,103.67,103.67,0,0,0,25.64,29.72A8,8,0,0,1,80.89,237Z',
  'magnifying-glass': 'M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z',
  'wallet': 'M216,64H56a8,8,0,0,1,0-16H192a8,8,0,0,0,0-16H56A24,24,0,0,0,32,56V184a24,24,0,0,0,24,24H216a16,16,0,0,0,16-16V80A16,16,0,0,0,216,64Zm0,128H56a8,8,0,0,1-8-8V78.63A23.84,23.84,0,0,0,56,80H216Zm-48-60a12,12,0,1,1,12,12A12,12,0,0,1,168,132Z',
  'plant': 'M247.63,47.89a8,8,0,0,0-7.52-7.52c-51.76-3-93.32,12.74-111.18,42.22-11.8,19.49-11.78,43.16-.16,65.74a71.34,71.34,0,0,0-14.17,27L98.33,159c7.82-16.33,7.52-33.35-1-47.49-13.2-21.79-43.67-33.47-81.5-31.25a8,8,0,0,0-7.52,7.52c-2.23,37.83,9.46,68.3,31.25,81.5A45.82,45.82,0,0,0,63.44,176,54.58,54.58,0,0,0,87,170.33l25,25V224a8,8,0,0,0,16,0V194.51a55.61,55.61,0,0,1,12.27-35,73.91,73.91,0,0,0,33.31,8.4,60.9,60.9,0,0,0,31.83-8.86C234.89,141.21,250.67,99.65,247.63,47.89ZM47.81,155.6C32.47,146.31,23.79,124.32,24,96c28.32-.24,50.31,8.47,59.6,23.81,4.85,8,5.64,17.33,2.46,26.94L61.65,122.34a8,8,0,0,0-11.31,11.31l24.41,24.41C65.14,161.24,55.82,160.45,47.81,155.6Zm149.31-10.22c-13.4,8.11-29.15,8.73-45.15,2l53.69-53.7a8,8,0,0,0-11.31-11.31L140.65,136c-6.76-16-6.15-31.76,2-45.15,13.94-23,47-35.82,89.33-34.83C232.94,98.34,220.14,131.44,197.12,145.38Z',
  'clock': 'M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm64-88a8,8,0,0,1-8,8H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v48h48A8,8,0,0,1,192,128Z',
  'map-pin': 'M128,64a40,40,0,1,0,40,40A40,40,0,0,0,128,64Zm0,64a24,24,0,1,1,24-24A24,24,0,0,1,128,128Zm0-112a88.1,88.1,0,0,0-88,88c0,31.4,14.51,64.68,42,96.25a254.19,254.19,0,0,0,41.45,38.3,8,8,0,0,0,9.18,0A254.19,254.19,0,0,0,174,200.25c27.45-31.57,42-64.85,42-96.25A88.1,88.1,0,0,0,128,16Zm0,206c-16.53-13-72-60.75-72-118a72,72,0,0,1,144,0C200,161.23,144.53,209,128,222Z',
  'robot': 'M200,48H136V16a8,8,0,0,0-16,0V48H56A32,32,0,0,0,24,80V192a32,32,0,0,0,32,32H200a32,32,0,0,0,32-32V80A32,32,0,0,0,200,48Zm16,144a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V80A16,16,0,0,1,56,64H200a16,16,0,0,1,16,16Zm-52-56H92a28,28,0,0,0,0,56h72a28,28,0,0,0,0-56Zm-24,16v24H116V152ZM80,164a12,12,0,0,1,12-12h8v24H92A12,12,0,0,1,80,164Zm84,12h-8V152h8a12,12,0,0,1,0,24ZM72,108a12,12,0,1,1,12,12A12,12,0,0,1,72,108Zm88,0a12,12,0,1,1,12,12A12,12,0,0,1,160,108Z',
  'handshake': 'M254.3,107.91,228.78,56.85a16,16,0,0,0-21.47-7.15L182.44,62.13,130.05,48.27a8.14,8.14,0,0,0-4.1,0L73.56,62.13,48.69,49.7a16,16,0,0,0-21.47,7.15L1.7,107.9a16,16,0,0,0,7.15,21.47l27,13.51,55.49,39.63a8.06,8.06,0,0,0,2.71,1.25l64,16a8,8,0,0,0,7.6-2.1l55.07-55.08,26.42-13.21a16,16,0,0,0,7.15-21.46Zm-54.89,33.37L165,113.72a8,8,0,0,0-10.68.61C136.51,132.27,116.66,130,104,122L147.24,80h31.81l27.21,54.41ZM41.53,64,62,74.22,36.43,125.27,16,115.06Zm116,119.13L99.42,168.61l-49.2-35.14,28-56L128,64.28l9.8,2.59-45,43.68-.08.09a16,16,0,0,0,2.72,24.81c20.56,13.13,45.37,11,64.91-5L188,152.66Zm62-57.87-25.52-51L214.47,64,240,115.06Zm-87.75,92.67a8,8,0,0,1-7.75,6.06,8.13,8.13,0,0,1-1.95-.24L80.41,213.33a7.89,7.89,0,0,1-2.71-1.25L51.35,193.26a8,8,0,0,1,9.3-13l25.11,17.94L126,208.24A8,8,0,0,1,131.82,217.94Z',
  'qr-code': 'M104,40H56A16,16,0,0,0,40,56v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V56A16,16,0,0,0,104,40Zm0,64H56V56h48v48Zm0,32H56a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V152A16,16,0,0,0,104,136Zm0,64H56V152h48v48ZM200,40H152a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm0,64H152V56h48v48Zm-64,72V144a8,8,0,0,1,16,0v32a8,8,0,0,1-16,0Zm80-16a8,8,0,0,1-8,8H184v40a8,8,0,0,1-8,8H144a8,8,0,0,1,0-16h24V144a8,8,0,0,1,16,0v8h24A8,8,0,0,1,216,160Zm0,32v16a8,8,0,0,1-16,0V192a8,8,0,0,1,16,0Z',
  'hourglass-medium': 'M200,75.64V40a16,16,0,0,0-16-16H72A16,16,0,0,0,56,40V76a16.07,16.07,0,0,0,6.4,12.8L114.67,128,62.4,167.2A16.07,16.07,0,0,0,56,180v36a16,16,0,0,0,16,16H184a16,16,0,0,0,16-16V180.36a16.09,16.09,0,0,0-6.35-12.77L141.27,128l52.38-39.6A16.05,16.05,0,0,0,200,75.64ZM72,40H184V75.64L178.23,80H77.33L72,76Zm56,78L98.67,96h58.4Zm56,98H72V180l48-36v24a8,8,0,0,0,16,0V144.08l48,36.28Z',
  'repeat': 'M24,128A72.08,72.08,0,0,1,96,56H204.69L194.34,45.66a8,8,0,0,1,11.32-11.32l24,24a8,8,0,0,1,0,11.32l-24,24a8,8,0,0,1-11.32-11.32L204.69,72H96a56.06,56.06,0,0,0-56,56,8,8,0,0,1-16,0Zm200-8a8,8,0,0,0-8,8,56.06,56.06,0,0,1-56,56H51.31l10.35-10.34a8,8,0,0,0-11.32-11.32l-24,24a8,8,0,0,0,0,11.32l24,24a8,8,0,0,0,11.32-11.32L51.31,200H160a72.08,72.08,0,0,0,72-72A8,8,0,0,0,224,120Z',
  'lightning': 'M215.79,118.17a8,8,0,0,0-5-5.66L153.18,90.9l14.66-73.33a8,8,0,0,0-13.69-7l-112,120a8,8,0,0,0,3,13l57.63,21.61L88.16,238.43a8,8,0,0,0,13.69,7l112-120A8,8,0,0,0,215.79,118.17ZM109.37,214l10.47-52.38a8,8,0,0,0-5-9.06L62,132.71l84.62-90.66L136.16,94.43a8,8,0,0,0,5,9.06l52.8,19.8Z',
  'camera': 'M208,56H180.28L166.65,35.56A8,8,0,0,0,160,32H96a8,8,0,0,0-6.65,3.56L75.71,56H48A24,24,0,0,0,24,80V192a24,24,0,0,0,24,24H208a24,24,0,0,0,24-24V80A24,24,0,0,0,208,56Zm8,136a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V80a8,8,0,0,1,8-8H80a8,8,0,0,0,6.66-3.56L100.28,48h55.43l13.63,20.44A8,8,0,0,0,176,72h32a8,8,0,0,1,8,8ZM128,88a44,44,0,1,0,44,44A44.05,44.05,0,0,0,128,88Zm0,72a28,28,0,1,1,28-28A28,28,0,0,1,128,160Z',
  'person-simple-walk': 'M152,80a32,32,0,1,0-32-32A32,32,0,0,0,152,80Zm0-48a16,16,0,1,1-16,16A16,16,0,0,1,152,32Zm64,112a8,8,0,0,1-8,8c-35.31,0-52.95-17.81-67.12-32.12-2.74-2.77-5.36-5.4-8-7.84l-13.43,30.88,37.2,26.57A8,8,0,0,1,160,176v56a8,8,0,0,1-16,0V180.12l-31.07-22.2L79.34,235.19A8,8,0,0,1,72,240a7.84,7.84,0,0,1-3.19-.67,8,8,0,0,1-4.15-10.52l54.08-124.37c-9.31-1.65-20.92,1.2-34.7,8.58a163.88,163.88,0,0,0-30.57,21.77,8,8,0,0,1-10.95-11.66c2.5-2.35,61.69-57.23,98.72-25.08,3.83,3.32,7.48,7,11,10.57C166.19,122.7,179.36,136,208,136A8,8,0,0,1,216,144Z',
  'coffee': 'M80,56V24a8,8,0,0,1,16,0V56a8,8,0,0,1-16,0Zm40,8a8,8,0,0,0,8-8V24a8,8,0,0,0-16,0V56A8,8,0,0,0,120,64Zm32,0a8,8,0,0,0,8-8V24a8,8,0,0,0-16,0V56A8,8,0,0,0,152,64Zm96,56v8a40,40,0,0,1-37.51,39.91,96.59,96.59,0,0,1-27,40.09H208a8,8,0,0,1,0,16H32a8,8,0,0,1,0-16H56.54A96.3,96.3,0,0,1,24,136V88a8,8,0,0,1,8-8H208A40,40,0,0,1,248,120ZM200,96H40v40a80.27,80.27,0,0,0,45.12,72h69.76A80.27,80.27,0,0,0,200,136Zm32,24a24,24,0,0,0-16-22.62V136a95.78,95.78,0,0,1-1.2,15A24,24,0,0,0,232,128Z',
  'lock-simple': 'M208,80H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80ZM96,56a32,32,0,0,1,64,0V80H96ZM208,208H48V96H208V208Z',
  'bank': 'M24,104H48v64H32a8,8,0,0,0,0,16H224a8,8,0,0,0,0-16H208V104h24a8,8,0,0,0,4.19-14.81l-104-64a8,8,0,0,0-8.38,0l-104,64A8,8,0,0,0,24,104Zm40,0H96v64H64Zm80,0v64H112V104Zm48,64H160V104h32ZM128,41.39,203.74,88H52.26ZM248,208a8,8,0,0,1-8,8H16a8,8,0,0,1,0-16H240A8,8,0,0,1,248,208Z',
  'receipt': 'M72,104a8,8,0,0,1,8-8h96a8,8,0,0,1,0,16H80A8,8,0,0,1,72,104Zm8,40h96a8,8,0,0,0,0-16H80a8,8,0,0,0,0,16ZM232,56V208a8,8,0,0,1-11.58,7.15L192,200.94l-28.42,14.21a8,8,0,0,1-7.16,0L128,200.94,99.58,215.15a8,8,0,0,1-7.16,0L64,200.94,35.58,215.15A8,8,0,0,1,24,208V56A16,16,0,0,1,40,40H216A16,16,0,0,1,232,56Zm-16,0H40V195.06l20.42-10.22a8,8,0,0,1,7.16,0L96,199.06l28.42-14.22a8,8,0,0,1,7.16,0L160,199.06l28.42-14.22a8,8,0,0,1,7.16,0L216,195.06Z',
  'envelope-simple': 'M224,48H32a8,8,0,0,0-8,8V192a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A8,8,0,0,0,224,48ZM203.43,64,128,133.15,52.57,64ZM216,192H40V74.19l82.59,75.71a8,8,0,0,0,10.82,0L216,74.19V192Z',
  'paper-plane-tilt': 'M227.32,28.68a16,16,0,0,0-15.66-4.08l-.15,0L19.57,82.84a16,16,0,0,0-2.49,29.8L102,154l41.3,84.87A15.86,15.86,0,0,0,157.74,248q.69,0,1.38-.06a15.88,15.88,0,0,0,14-11.51l58.2-191.94c0-.05,0-.1,0-.15A16,16,0,0,0,227.32,28.68ZM157.83,231.85l-.05.14,0-.07-40.06-82.3,48-48a8,8,0,0,0-11.31-11.31l-48,48L24.08,98.25l-.07,0,.14,0L216,40Z',
  'book-open': 'M232,48H160a40,40,0,0,0-32,16A40,40,0,0,0,96,48H24a8,8,0,0,0-8,8V200a8,8,0,0,0,8,8H96a24,24,0,0,1,24,24,8,8,0,0,0,16,0,24,24,0,0,1,24-24h72a8,8,0,0,0,8-8V56A8,8,0,0,0,232,48ZM96,192H32V64H96a24,24,0,0,1,24,24V200A39.81,39.81,0,0,0,96,192Zm128,0H160a39.81,39.81,0,0,0-24,8V88a24,24,0,0,1,24-24h64Z',
  'books': 'M231.65,194.55,198.46,36.75a16,16,0,0,0-19-12.39L132.65,34.42a16.08,16.08,0,0,0-12.3,19l33.19,157.8A16,16,0,0,0,169.16,224a16.25,16.25,0,0,0,3.38-.36l46.81-10.06A16.09,16.09,0,0,0,231.65,194.55ZM136,50.15c0-.06,0-.09,0-.09l46.8-10,3.33,15.87L139.33,66Zm6.62,31.47,46.82-10.05,3.34,15.9L146,97.53Zm6.64,31.57,46.82-10.06,13.3,63.24-46.82,10.06ZM216,197.94l-46.8,10-3.33-15.87L212.67,182,216,197.85C216,197.91,216,197.94,216,197.94ZM104,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V48A16,16,0,0,0,104,32ZM56,48h48V64H56Zm0,32h48v96H56Zm48,128H56V192h48v16Z',
  'funnel': 'M230.6,49.53A15.81,15.81,0,0,0,216,40H40A16,16,0,0,0,28.19,66.76l.08.09L96,139.17V216a16,16,0,0,0,24.87,13.32l32-21.34A16,16,0,0,0,160,194.66V139.17l67.74-72.32.08-.09A15.8,15.8,0,0,0,230.6,49.53ZM40,56h0Zm106.18,74.58A8,8,0,0,0,144,136v58.66L112,216V136a8,8,0,0,0-2.16-5.47L40,56H216Z',
  'eye': 'M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.47,133.47,0,0,1,25,128,133.33,133.33,0,0,1,48.07,97.25C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.25A133.46,133.46,0,0,1,231.05,128C223.84,141.46,192.43,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z',
  'note-pencil': 'M229.66,58.34l-32-32a8,8,0,0,0-11.32,0l-96,96A8,8,0,0,0,88,128v32a8,8,0,0,0,8,8h32a8,8,0,0,0,5.66-2.34l96-96A8,8,0,0,0,229.66,58.34ZM124.69,152H104V131.31l64-64L188.69,88ZM200,76.69,179.31,56,192,43.31,212.69,64ZM224,128v80a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32h80a8,8,0,0,1,0,16H48V208H208V128a8,8,0,0,1,16,0Z',
};
function icon(name, cls = '') {
  return `<svg class="ic${cls ? ` ${cls}` : ''}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false"><path d="${ICON_D[name]}"/></svg>`;
}

let OPTIONS = null;
let timers = [];
let routeToken = 0;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (n) => `${Number(n).toLocaleString('ko-KR')}`;

function fmtDate(s, withWeekday = false) {
  const [, m, d] = s.split('-').map(Number);
  const wd = new Date(`${s}T00:00:00`).getDay();
  return `${m}월 ${d}일${withWeekday ? ` (${WD[wd === 0 ? 7 : wd]})` : ''}`;
}
function fmtTime(t) {
  const [h, m] = t.split(':').map(Number);
  if (h === 24) return '자정';
  const ap = h < 12 ? '오전' : '오후';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${ap} ${hh}:${String(m).padStart(2, '0')}`;
}
function fmtMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}분`;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function api(path, { method = 'GET', body } = {}) {
  // 단독 실행 HTML(npm run build:standalone)에서는 브라우저 안의 가짜 서버를 쓴다.
  if (window.__mockApi) {
    const { status, data } = await window.__mockApi(path, { method, body });
    if (status >= 400) {
      const err = new Error(data.error || '요청을 처리하지 못했어요.');
      err.status = status;
      throw err;
    }
    return data;
  }
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || '요청을 처리하지 못했어요.');
    err.status = res.status;
    throw err;
  }
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

// 일이 빨리 끝나도 로딩 화면을 최소 ms 동안 보여 준다 (오류는 기다리지 않고 바로 알림)
async function withLoading(text, task, ms = 3000) {
  const modal = $('#modal');
  modal.innerHTML = `
    <div class="finding">
      <div class="spinner"></div>
      <b>${text}</b>
    </div>`;
  modal.hidden = false;
  const minWait = new Promise((r) => setTimeout(r, ms));
  try {
    const res = await task();
    await minWait;
    return res;
  } finally {
    closeModal();
  }
}

function every(ms, fn) {
  timers.push(setInterval(fn, ms));
}

function setTop({ title = '', back = null, brand = false, right = '' } = {}) {
  topbar.hidden = false;
  topbar.innerHTML = `
    <div>${back ? `<a class="icon-btn" href="${back}" aria-label="뒤로">${icon('caret-left')}</a>` : ''}</div>
    ${brand ? '<div class="center"><img class="logo" src="logo.png" alt="스터디버디"></div>' : `<h1>${esc(title)}</h1>`}
    <div>${right}</div>`;
}

function setTabs(active) {
  tabbar.hidden = !active;
  view.classList.toggle('no-tabs', !active);
  $$('a', tabbar).forEach((a) => a.classList.toggle('active', a.dataset.tab === active));
}

const loading = () => { view.innerHTML = '<div class="spinner"></div>'; };

// 데모(가상) 메이트 표시
const botBadge = (u) => (u?.isBot ? ' <span class="pill gray" title="실제 사람이 아닌 체험용 메이트">데모 메이트</span>' : '');

// 프로필 사진이 있으면 사진, 없으면 아바타 이모지
const avatarHTML = (u, size = '') => (u?.photo
  ? `<div class="avatar photo ${size}"><img src="${esc(u.photo)}" alt="${esc(u.name ?? '')} 프로필 사진" loading="lazy"></div>`
  : `<div class="avatar ${size}">${esc(u?.avatar ?? '🙂')}</div>`);

// 화면을 떠날 때 정리할 일 (실시간 연결 끊기 등). 라우터가 화면을 바꿀 때 모두 실행한다.
let cleanups = [];
const onLeave = (fn) => cleanups.push(fn);

// 사진을 긴 변 maxDim px 이하 JPEG로 줄여 data URL로 만든다. (원본은 서버로 보내지 않음)
async function compressImage(file, maxDim = 1280, quality = 0.82) {
  if (!file?.type?.startsWith('image/')) throw new Error('사진 파일을 골라 주세요.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('이 사진은 열 수 없어요. 다른 사진을 골라 주세요.'));
      i.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // 투명 PNG도 흰 배경으로
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let out = canvas.toDataURL('image/jpeg', quality);
    if (out.length > 1_400_000) out = canvas.toDataURL('image/jpeg', 0.6);
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 보증금 입금 안내 (운영진 계좌 · 금액 · 입금자명)
const depositGuide = (amount, depositor) => `
  <div class="deposit-guide">
    <div><span>입금 계좌</span><b>${esc(OPTIONS.deposits?.account ?? '운영진에게 문의해 주세요')}</b></div>
    <div><span>금액</span><b>${won(amount)}원</b></div>
    <div><span>입금자명</span><b>${esc(depositor ?? '')}</b></div>
    <p class="tiny muted">운영진이 입금을 확인하면 바로 메이트 찾기가 시작돼요.</p>
  </div>`;

// 사진 크게 보기 (아무 데나 누르면 닫힘)
function zoomPhoto(src) {
  const modal = $('#modal');
  modal.innerHTML = `<div class="photo-zoom"><img src="${esc(src)}" alt="사진 크게 보기"><p class="tiny">화면을 누르면 닫혀요</p></div>`;
  modal.hidden = false;
  modal.onclick = closeModal;
}

// 시간표 칸("요일-시간대번호") → 요일별 이어진 시간 [{ day, start, end }]
function runsOfCells(cells) {
  const S = OPTIONS.timeSlots;
  const byDay = {};
  for (const c of cells) {
    const [d, i] = c.split('-').map(Number);
    (byDay[d] ??= []).push(i);
  }
  const runs = [];
  for (const d of Object.keys(byDay).map(Number).sort((x, y) => x - y)) {
    const idx = [...new Set(byDay[d])].sort((x, y) => x - y);
    let from = idx[0];
    for (let k = 1; k <= idx.length; k++) {
      if (k < idx.length && idx[k] === idx[k - 1] + 1) continue;
      runs.push({ day: d, start: S[from].start, end: S[idx[k - 1]].end });
      if (k < idx.length) from = idx[k];
    }
  }
  return runs;
}

// 요일별 시간 → 짧은 요약. 같은 시간인 요일끼리 묶는다.
function scheduleText(runs) {
  const groups = new Map();
  for (const r of runs) {
    const key = `${fmtTime(r.start)}~${fmtTime(r.end)}`;
    groups.set(key, [...(groups.get(key) ?? []), r.day]);
  }
  return [...groups].map(([time, days]) => `${[...new Set(days)].map((d) => WD[d]).join('·')} ${time}`).join(' · ');
}

function styleLabels(keys) {
  return keys.map((k) => OPTIONS.styles[k]?.label ?? k).join(' · ');
}

// ───────────────────────── 라우터 ─────────────────────────

const routes = {
  login: renderLogin,
  signup: renderSignup,
  reset: renderReset,
  home: renderHome,
  apply: renderApply,
  match: renderMatch,
  chat: renderChat,
  me: renderMe,
  'me/edit': renderEditProfile,
  admin: renderAdmin,
};

async function router() {
  timers.forEach(clearInterval);
  timers = [];
  cleanups.forEach((fn) => { try { fn(); } catch { /* 무시 */ } });
  cleanups = [];
  closeModal();
  const token = ++routeToken;
  const name = location.hash.replace(/^#\/?/, '') || 'home';
  scroller().scrollTo(0, 0);
  const pastId = name.match(/^history\/(\d+)$/)?.[1];
  const [, sub, subId] = name.match(/^(match|chat)\/(\d+)$/) ?? [];
  const render = pastId ? (alive) => renderPast(alive, Number(pastId))
    : sub === 'match' ? (alive) => renderMatch(alive, Number(subId))
      : sub === 'chat' ? (alive) => renderChat(alive, Number(subId))
        : routes[name] ?? renderHome;
  try {
    if (!OPTIONS) OPTIONS = await api('/options');
    await render(() => token === routeToken);
  } catch (err) {
    if (err.status === 401 && !['login', 'signup', 'reset'].includes(name)) {
      // 로그인한 뒤 원래 가려던 화면(예: 운영자 화면)으로 돌아온다
      try { sessionStorage.setItem('sb-next', name); } catch { /* 무시 */ }
      location.hash = '#/login';
      return;
    }
    console.error(err);
    view.innerHTML = `<div class="empty"><div class="em">${icon('warning')}</div><h3>문제가 생겼어요</h3><p>${esc(err.message)}</p></div>`;
  }
}

window.addEventListener('hashchange', router);
router();
countVisit();

// 방문 기록: 브라우저마다 무작위 id를 하나 만들어 두고, 사이트를 열 때마다 서버에 알린다 (실패해도 화면에는 영향 없음)
function countVisit() {
  try {
    let id = localStorage.getItem('visitorId');
    if (!id) {
      id = crypto.getRandomValues(new Uint32Array(4)).reduce((s, n) => s + n.toString(36).padStart(7, '0'), '');
      localStorage.setItem('visitorId', id);
    }
    api('/visit', { method: 'POST', body: { id } }).catch(() => {});
  } catch { /* 무시 */ }
}

// ───────────────────────── 로그인 / 가입 ─────────────────────────

function authShell(inner) {
  setTop({});
  setTabs(null);
  // 로그인·가입·비밀번호 찾기 화면에는 위쪽 띠가 없다 (스크롤할 때 로고를 가리지 않게)
  topbar.innerHTML = '';
  topbar.hidden = true;
  view.innerHTML = `
    <div class="auth">
      <img class="logo lg" src="logo.png" alt="스터디버디">
      ${inner}
    </div>`;
  $$('.email-input input').forEach(placeDomain);
}

// 실서비스는 국민대 메일만 받는다. 칸에는 @ 앞(아이디)만 입력하고, 보낼 때 @kookmin.ac.kr 을 붙인다.
// 운영자 로그인(운영진 개인 메일도 허용)일 때는 전체 주소를 그대로 입력한다.
const fullEmailInput = () => !OPTIONS.emailDomain || forAdmin();
const withDomain = (email) => {
  const v = String(email ?? '').trim();
  if (!v || fullEmailInput()) return v;
  return `${v.split('@')[0]}@${OPTIONS.emailDomain}`;
};

const emailLabel = () => (fullEmailInput() ? '이메일' : '국민대 메일');

// 메일 입력칸. 국민대 메일만 받을 때는 입력한 아이디 바로 뒤에 @kookmin.ac.kr 을 붙여 보여 준다.
const emailInput = () => (fullEmailInput()
  ? '<input class="input" name="email" type="email" autocomplete="email" required>'
  : `<div class="email-input"><input class="input" name="email" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="아이디" required><span>@${esc(OPTIONS.emailDomain)}</span></div>`);

// @kookmin.ac.kr 을 입력한 글자(비어 있으면 '아이디' 안내 글자) 바로 뒤에 붙인다.
// 칸 끝까지 차면 오른쪽 끝에 멈추고, 글자는 그 앞에서 옆으로 밀린다.
const measureCtx = document.createElement('canvas').getContext('2d');
function placeDomain(input) {
  const span = input.nextElementSibling;
  if (!span) return;
  const cs = getComputedStyle(input);
  measureCtx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const text = input.value || input.placeholder;
  const left = parseFloat(cs.paddingLeft) + measureCtx.measureText(text).width + 2;
  span.style.left = `${Math.min(left, input.clientWidth - span.offsetWidth - 12)}px`;
}
document.fonts?.ready.then(() => $$('.email-input input').forEach(placeDomain));

// 아이디 칸에 전체 주소를 붙여 넣으면 @ 앞만 남긴다
document.addEventListener('input', (e) => {
  if (!e.target.closest?.('.email-input')) return;
  if (e.target.value.includes('@')) e.target.value = e.target.value.split('@')[0];
  placeDomain(e.target);
});

// 이메일 + "인증번호 받기" 버튼 + 인증번호 입력칸 (메일 인증을 쓰는 실서비스에서만)
function emailCodeFields() {
  if (!OPTIONS.emailVerification) {
    return `<label class="field"><span>${emailLabel()}</span>${emailInput()}</label>`;
  }
  return `
    <div class="field"><span>${emailLabel()}</span>
      <div class="row">
        ${emailInput()}
        <button type="button" class="btn inline-btn" id="send-code">인증번호 받기</button>
      </div>
    </div>
    <label class="field" id="code-field" hidden><span>인증번호 (메일로 받은 6자리)</span>
      <input class="input code" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000">
    </label>
    <button type="button" class="link-btn tiny" id="no-mail" hidden>메일이 안 와요</button>`;
}

// 인증 메일이 안 올 때: 확인할 것 안내 + 운영진에게 도움 요청 (운영진이 본인 확인 후 인증번호를 직접 알려 줌)
function showMailHelp(form, purpose) {
  const modal = $('#modal');
  modal.innerHTML = `
    <form class="sheet" id="help-form">
      <h3>인증 메일이 안 와요</h3>
      <ol class="small muted help-list">
        <li>메일함의 <b>스팸함·프로모션함</b>을 확인해 주세요. 보내는 사람은 "스터디버디"예요.</li>
        <li>주소가 맞는지 확인해 주세요: <b>${esc(withDomain(form.email.value) || '(입력 안 됨)')}</b></li>
        <li>학교 메일은 몇 분 늦게 오기도 해요. 먼저 온 번호도 10분 동안 쓸 수 있어요.</li>
      </ol>
      <p class="small mt"><b>그래도 안 오면</b> 운영진이 확인 후 인증번호를 문자로 보내 드려요.</p>
      <label class="field"><span>이름</span><input class="input" name="name" maxlength="20" value="${esc(form.name?.value ?? '')}" required></label>
      <label class="field"><span>전화번호</span><input class="input" name="phone" type="tel" inputmode="numeric" value="${esc(form.phone?.value ?? '')}" placeholder="010-1234-5678" required></label>
      <button class="btn primary block mt">운영진에게 도움 요청</button>
      <button type="button" class="btn ghost block" id="help-close">닫기</button>
    </form>`;
  modal.hidden = false;
  $('#help-close').addEventListener('click', closeModal);
  $('#help-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      const res = await api('/auth/help', { method: 'POST', body: { ...fd, email: withDomain(form.email.value), purpose } });
      closeModal();
      $('#code-field', form).hidden = false;
      form.code.required = true;
      toast(res.already ? '이미 요청했어요. 운영진이 곧 연락드려요.' : '요청했어요. 운영진이 확인 후 인증번호를 보내 드려요.');
    } catch (err) { toast(err.message, true); }
  });
}

function bindSendCode(form, purpose) {
  const btn = $('#send-code', form);
  if (!btn) return;
  const noMail = $('#no-mail', form);
  noMail?.addEventListener('click', () => showMailHelp(form, purpose));
  btn.addEventListener('click', async () => {
    const email = withDomain(form.email.value);
    if (!email) return toast('메일 주소를 입력해 주세요.', true);
    btn.disabled = true;
    try {
      await api('/auth/code', { method: 'POST', body: { email, purpose } });
      $('#code-field', form).hidden = false;
      form.code.required = true;
      form.code.focus();
      toast('메일로 인증번호를 보냈어요. (스팸함도 확인해 주세요)');
      setTimeout(() => { if (noMail) noMail.hidden = false; }, 20000);
      let left = 60;
      btn.textContent = `다시 받기 (${left})`;
      const timer = setInterval(() => {
        left -= 1;
        if (left <= 0 || !btn.isConnected) {
          clearInterval(timer);
          btn.disabled = false;
          btn.textContent = '다시 받기';
        } else {
          btn.textContent = `다시 받기 (${left})`;
        }
      }, 1000);
    } catch (err) {
      btn.disabled = false;
      toast(err.message, true);
      if (noMail && err.status >= 500) noMail.hidden = false; // 보내기 실패 → 바로 도움 요청 가능
    }
  });
}

// 로그인·가입 뒤 이동할 화면 (운영자 화면에서 로그인하러 온 경우 다시 운영자 화면으로)
const nextAfterLogin = () => {
  let next = null;
  try { next = sessionStorage.getItem('sb-next'); sessionStorage.removeItem('sb-next'); } catch { /* 무시 */ }
  return `#/${next || 'home'}`;
};
const forAdmin = () => { try { return sessionStorage.getItem('sb-next') === 'admin'; } catch { return false; } };

async function renderLogin() {
  const admin = forAdmin();
  authShell(`
    <h2>${admin ? '운영자 로그인' : '같은 시간에<br>함께 시작하는 공부'}</h2>
    <p class="lead">${admin ? '운영진 계정으로 로그인해 주세요. 운영진으로 등록된 메일은 국민대 메일이 아니어도 돼요. 처음이면 같은 메일로 회원가입하세요.'
    : `${OPTIONS.emailDomain ? '국민대 학생을 위한 ' : ''}1주일 단위 1:1 스터디 메이트 매칭, 스터디버디`}</p>
    <form id="f" class="card">
      <label class="field"><span>${emailLabel()}</span>${emailInput()}</label>
      <label class="field"><span>비밀번호</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary block mt-lg">로그인</button>
    </form>
    <p class="switch-link">처음이신가요? <a href="#/signup">회원가입</a>${OPTIONS.emailVerification ? ' · <a href="#/reset">비밀번호 찾기</a>' : ''}</p>
    ${OPTIONS.demoLogin ? `
      <div class="demo-login">
        <button type="button" class="btn block" id="demo-login">데모 계정으로 로그인</button>
        <p class="tiny muted center">가입 없이 둘러볼 수 있는 체험용 계정이에요.</p>
      </div>` : ''}`);
  if (!admin) showIntro();
  $('#demo-login')?.addEventListener('click', async () => {
    try {
      await api('/auth/demo', { method: 'POST' });
      location.hash = nextAfterLogin();
    } catch (err) { toast(err.message, true); }
  });
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    fd.email = withDomain(fd.email);
    try {
      await api('/auth/login', { method: 'POST', body: fd });
      location.hash = nextAfterLogin();
    } catch (err) { toast(err.message, true); }
  });
}

async function renderSignup() {
  authShell(`
    <h2>공부 약속이<br>지켜지는 구조</h2>
    <p class="lead">${OPTIONS.emailDomain ? '국민대학교 메일로 가입할 수 있어요.' : ''}</p>
    <form id="f" class="card">
      ${emailCodeFields()}
      <label class="field"><span>이름</span><input class="input" name="name" maxlength="20" autocomplete="name" required></label>
      <label class="field"><span>학과</span><input class="input" name="department" maxlength="30" placeholder="예: 경영정보학부" required></label>
      <label class="field"><span>전화번호</span><input class="input" name="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="010-1234-5678" required></label>
      <p class="tiny muted">학과와 전화번호는 운영 연락용으로만 쓰고, 메이트에게는 보이지 않아요.</p>
      <label class="field"><span>비밀번호 (6자 이상)</span><input class="input" name="password" type="password" minlength="6" autocomplete="new-password" required></label>
      <button class="btn primary block mt-lg">가입하고 시작하기</button>
    </form>
    <p class="switch-link">이미 계정이 있나요? <a href="#/login">로그인</a></p>`);
  const form = $('#f');
  bindSendCode(form, 'signup');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (OPTIONS.emailVerification && $('#code-field').hidden) return toast("먼저 '인증번호 받기'를 눌러 주세요.", true);
    const fd = Object.fromEntries(new FormData(form));
    fd.email = withDomain(fd.email);
    try {
      await withLoading('가입하는 중이에요', () => api('/auth/signup', { method: 'POST', body: fd }));
      toast('환영해요! 이번 주 메이트를 찾아볼까요?');
      location.hash = nextAfterLogin();
    } catch (err) { toast(err.message, true); }
  });
}

// 로그인 화면에 들어오면 스터디버디 소개 팝업을 띄운다
// 스터디버디 소개 (로그인 팝업·홈 진행 안내 카드 공용)
const introBody = () => `
      <p class="intro-team">국민대학교 창업동아리 <b>MateUp팀</b>이 운영해요.</p>
      <p class="small muted">국민대생끼리 1:1 공부 메이트를 이어 주는 서비스입니다.</p>
      <ol class="steps mt">
        <li><b>매칭 신청</b><span class="small muted">날짜, 장소, 공부 스타일을 고르면 조건이 맞는 메이트와 바로 연결돼요.</span></li>
        <li><b>함께 공부</b><span class="small muted">약속한 날 만나서 각자 공부하고, 서로의 QR을 찍어 출석을 확인해요.</span></li>
      </ol>
      <div class="notice mt">${icon('calendar-blank')}<span>이번 회차: ${studyPeriodText()}</span></div>
      <p class="small muted center mt">소식은 인스타그램 <a class="link" href="https://www.instagram.com/study._.buddys/" target="_blank" rel="noopener">@study._.buddys</a></p>`;

function showIntro() {
  const modal = $('#modal');
  modal.innerHTML = `
    <div class="sheet intro">
      <h3>스터디버디는요</h3>
      ${introBody()}
      <button class="btn primary block mt" id="intro-ok">확인했어요</button>
    </div>`;
  modal.hidden = false;
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  $('#intro-ok').addEventListener('click', closeModal);
}

async function renderReset() {
  if (!OPTIONS.emailVerification) {
    authShell(`<div class="empty"><h3>비밀번호 찾기</h3><p>데모 버전에서는 지원하지 않아요.</p><a class="btn mt" href="#/login">로그인으로</a></div>`);
    return;
  }
  authShell(`
    <h2>비밀번호 찾기</h2>
    <p class="lead">가입한 국민대 메일로 인증번호를 보내 드려요.</p>
    <form id="f" class="card">
      ${emailCodeFields()}
      <label class="field"><span>새 비밀번호 (6자 이상)</span><input class="input" name="password" type="password" minlength="6" autocomplete="new-password" required></label>
      <button class="btn primary block mt-lg">비밀번호 바꾸기</button>
    </form>
    <p class="switch-link"><a href="#/login">로그인으로 돌아가기</a></p>`);
  const form = $('#f');
  bindSendCode(form, 'reset');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('#code-field').hidden) return toast("먼저 '인증번호 받기'를 눌러 주세요.", true);
    const fd = Object.fromEntries(new FormData(form));
    fd.email = withDomain(fd.email);
    try {
      await api('/auth/reset', { method: 'POST', body: fd });
      toast('비밀번호를 바꿨어요. 다른 기기에서는 다시 로그인해 주세요.');
      location.hash = '#/home';
    } catch (err) { toast(err.message, true); }
  });
}

// ───────────────────────── 시간 칸 (신청 화면·홈 공용) ─────────────────────────

const toMinutes = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

// 요일 + 시간 범위 → 그 안에 들어가는 시간표 칸들
function cellsOfRun(day, start, end) {
  return OPTIONS.timeSlots
    .map((s, i) => [s, i])
    .filter(([s]) => toMinutes(s.start) >= toMinutes(start) && toMinutes(s.end) <= toMinutes(end))
    .map(([, i]) => `${day}-${i}`);
}

// 내가 이미 매칭·신청한 칸: 칸 → { kind: match|pending|personal, label, matchId }
// 이어진 칸 묶음의 첫 칸에만 이름(label)을 단다.
function myTimetable({ matches = [], pendingRequests = [], personal = [] }) {
  const map = new Map();
  const put = (cells, info) => cells.forEach((c, k) => map.set(c, { ...info, label: k === 0 ? info.label : '' }));
  for (const m of matches) {
    for (const r of m.schedule) put(cellsOfRun(r.day, r.start, r.end), { kind: 'match', label: m.mate.name, matchId: m.id });
  }
  for (const req of pendingRequests) {
    for (const r of runsOfCells(req.cells)) put(cellsOfRun(r.day, r.start, r.end), { kind: 'pending', label: '대기' });
  }
  const byTitle = new Map();
  for (const p of personal) byTitle.set(p.title, [...(byTitle.get(p.title) ?? []), p.cell]);
  for (const [title, cells] of byTitle) {
    for (const r of runsOfCells(cells)) put(cellsOfRun(r.day, r.start, r.end), { kind: 'personal', label: title });
  }
  return map;
}

// ───────────────────────── 홈 ─────────────────────────

async function renderHome(alive) {
  setTop({ brand: true });
  setTabs('home');
  loading();
  const state = await api('/me');
  if (!alive()) return;
  const { user, matches, pendingRequests, personal, mateLeft, community, exam } = state;

  const reportCard = (m) => `
      <div class="card lime">
        <div class="card-head"><h2>${icon('chart-bar')}주간 리포트가 도착했어요</h2></div>
        <p class="small">${esc(m.mate.name)}님과의 ${m.round}주차 결과를 확인하고, 다음 주를 골라 주세요.</p>
        <a class="btn primary block mt" href="#/match/${m.id}">리포트 보기</a>
      </div>`;
  const matchCard = (m) => {
    const next = m.appointments.find((x) => ['open', 'studying', 'scheduled'].includes(x.me.status));
    return `
      <div class="card">
        <div class="card-head"><h2>${icon('users')}이번 주 메이트</h2><span class="pill">${m.round}주차</span></div>
        <div class="profile">
          ${avatarHTML(m.mate)}
          <div>
            <div class="name">${esc(m.mate.name)}${botBadge(m.mate)}</div>
            <div class="small muted">${esc(scheduleText(m.schedule))}</div>
            <div class="small muted">출석 ${m.stats.me.attended}/${m.stats.me.total} · 공부 ${fmtMinutes(m.stats.me.minutes)}</div>
          </div>
        </div>
        ${next ? `
          <div class="notice">${icon('calendar-blank')}<span>다음 약속 <b>${fmtDate(next.date, true)} ${fmtTime(next.startTime)}</b> · ${esc(next.location)}</span></div>`
        : `<div class="notice">${icon('check-circle')}<span>이번 주 약속을 모두 마쳤어요. 주간이 끝나면 리포트가 도착해요.</span></div>`}
        <a class="btn primary block mt" href="#/match/${m.id}">${next && ['open', 'studying'].includes(next.me.status) ? '지금 출석하러 가기' : '매칭 정보 보기'}</a>
      </div>`;
  };
  const pendingCard = (req) => `
      <div class="card">
        <div class="row" style="gap:12px">
          <span class="pending-ic">${icon(req.status === 'awaiting_deposit' ? 'wallet' : 'magnifying-glass')}</span>
          <div style="flex:1">
            <b>${req.status === 'awaiting_deposit' ? '보증금 입금 확인을 기다리는 중' : '메이트를 찾는 중'}</b>
            <p class="tiny muted">${esc(scheduleText(req.schedule))}<br>${esc(req.location)} · ${styleLabels(req.styles)}${req.deposit ? ` · 보증금 ${won(req.deposit)}원` : ''}</p>
          </div>
        </div>
        ${req.status === 'awaiting_deposit' ? depositGuide(req.deposit, req.depositor) : ''}
        <button class="btn ghost block mt danger sm" data-cancel="${req.id}">신청 취소하기</button>
      </div>`;

  let leftNote = '';
  if (mateLeft) {
    leftNote = `
      <div class="card">
        <div class="card-head"><h2>${icon('hand-waving')}메이트가 매칭을 그만뒀어요</h2></div>
        <p class="small">${esc(mateLeft.mateName)}님이 이번 주 매칭을 중간에 그만뒀어요.</p>
      </div>`;
  }
  const hasAny = matches.length || pendingRequests.length;
  // 기말고사 디데이 · 국민대 통계 (매칭 전에는 첫 카드 안에, 매칭 후에는 매칭 카드 아래에)
  const dday = exam ? (exam.dday === 0 ? 'D-DAY' : `D-${exam.dday}`) : '';
  const showPeople = community.studying > 0; // 국민대생 인원은 0명이면 숨긴다 (빈 서비스처럼 보이지 않게)
  const heroStats = !exam && !showPeople ? '' : `
        <div class="hero-stats">
          ${exam ? `<div><span>${esc(exam.name)}까지</span><p class="stat-row"><b>${dday}</b><span>${Number(exam.date.slice(5, 7))}월 ${Number(exam.date.slice(8))}일</span></p></div>` : ''}
          ${showPeople ? `<div><span>국민대생</span><p class="stat-row"><b>${community.studying}명</b><span>이번 주 함께 공부 중${community.waiting ? ` · 대기 ${community.waiting}명` : ''}</span></p></div>` : ''}
        </div>`;
  const homeStats = !exam && !showPeople ? '' : `
    <div class="home-stats">
      ${exam ? `<div class="stat"><span>${esc(exam.name)}까지</span><b>${dday}</b><span>${Number(exam.date.slice(5, 7))}월 ${Number(exam.date.slice(8))}일</span></div>` : ''}
      ${showPeople ? `<div class="stat"><span>국민대생</span><b>${community.studying}명</b><span>이번 주 함께 공부 중${community.waiting ? ` · 대기 ${community.waiting}명` : ''}</span></div>` : ''}
    </div>`;
  const ttCard = scheduleStack(matches, pendingRequests);
  // 매칭·신청이 있으면: 내 약속 스택 → 매칭 상태 카드들 → 통계
  // 없으면: 매칭 신청 카드(통계 포함) → 내 약속 스택
  const main = hasAny
    ? ttCard
      + [...matches.map((m) => (m.status === 'reported' ? reportCard(m) : matchCard(m))), ...pendingRequests.map(pendingCard)].join('')
      + '<a class="btn block mt" href="#/apply">다른 날짜에 매칭 추가 신청</a>'
      + homeStats
    : `${leftNote}
      <div class="card hero compact">
        <h2>이번 주, 같이 공부할 메이트를 찾아볼까요?</h2>
        ${heroStats}
        <a class="btn lime block" href="#/apply">매칭 신청하기</a>
      </div>
      ${ttCard}`;

  view.innerHTML = `
    <div class="row between home-hello">
      <div style="font-size:19px;font-weight:800">${esc(user.name)}님</div>
    </div>
    ${main}
    <div class="card">
      <div class="card-head"><h2>스터디버디는 이렇게 진행돼요</h2></div>
      ${introBody()}
    </div>`;

  $$('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('이 매칭 신청을 취소할까요?')) return;
    try {
      await withLoading('신청을 취소하는 중이에요', () => api(`/requests/${b.dataset.cancel}`, { method: 'DELETE' }));
      toast('신청을 취소했어요.');
      router();
    } catch (err) { toast(err.message, true); }
  }));

  if (pendingRequests.length) {
    const before = matches.length;
    every(4000, async () => {
      const s = await api('/me').catch(() => null);
      if (s && s.matches.length > before && alive()) {
        toast('메이트를 찾았어요!');
        location.hash = `#/match/${s.matches.at(-1).id}`;
      }
    });
  }
}

// 이번 회차 날짜·시간 한 줄 (예: 11/10(화)·11(수)·12(목) 오후 6~9시) — server/options.js STUDY_PERIOD 에서 만든다
function studyPeriodText() {
  const p = OPTIONS?.studyPeriod;
  if (!p?.dates?.length) return '';
  const days = p.dates.map((d, i) => {
    const wd = WD[new Date(`${d}T00:00:00`).getDay() || 7];
    const [m, day] = [Number(d.slice(5, 7)), Number(d.slice(8))];
    return i === 0 || Number(p.dates[i - 1].slice(5, 7)) !== m ? `${m}/${day}(${wd})` : `${day}(${wd})`;
  }).join('·');
  const h = (t) => Number(t.slice(0, 2)) % 12 || 12;
  return `${days} 오후 ${h(p.start)}~${h(p.end)}시`;
}

// 이번 회차 날짜별 내 약속 (위에서 아래로 쌓이는 카드)
//   매칭됨: 시간 · 메이트 · 장소 (누르면 매칭 화면)  /  대기 중: 시간 · 메이트 찾는 중  /  비어 있음: 신청 버튼
function scheduleStack(matches, pendingRequests) {
  const period = OPTIONS.studyPeriod;
  const range = (a, b) => `${a.slice(0, 5)}–${b.slice(0, 5)}`;
  const rows = period.dates.map((date) => {
    const day = new Date(`${date}T00:00:00`).getDay() || 7;
    const time = period.times?.[date] ?? period;
    const over = new Date(`${date}T00:00:00+09:00`).getTime() + toMinutes(time.end) * 60000 <= Date.now();
    const items = [];
    for (const m of matches) {
      for (const a of m.appointments.filter((x) => x.date === date)) {
        items.push(`
          <a class="stack-item match" href="#/match/${m.id}">
            <span class="dot"></span><b>${range(a.startTime, a.endTime)}</b>
            <span>${esc(m.mate.name)} · ${esc(m.location)}</span><span class="chev">${icon('caret-right')}</span>
          </a>`);
      }
    }
    for (const req of pendingRequests) {
      for (const r of req.schedule.filter((x) => x.day === day)) {
        const waitingDeposit = req.status === 'awaiting_deposit';
        items.push(`
          <div class="stack-item pending">
            <span class="dot"></span><b>${range(r.start, r.end)}</b>
            <span>${waitingDeposit ? '보증금 입금 확인 중' : '메이트 찾는 중'}</span>
          </div>`);
      }
    }
    if (!items.length) {
      items.push(over
        ? '<div class="stack-item empty"><span>지난 날짜예요</span></div>'
        : `<a class="stack-item empty" href="#/apply"><span>아직 약속이 없어요</span><span class="link">신청하기${icon('caret-right')}</span></a>`);
    }
    return `
      <div class="stack-day${over ? ' over' : ''}">
        <div class="stack-date"><b>${WD[day]}</b><small>${Number(date.slice(5, 7))}/${Number(date.slice(8))}</small></div>
        <div class="stack-items">${items.join('')}</div>
      </div>`;
  });
  return `
    <section class="card">
      <div class="card-head"><h2>${icon('calendar-blank')}이번 회차 내 약속</h2><span class="hint">${fmtTime(period.start)}~${fmtTime(period.end)}</span></div>
      <div class="stack">${rows.join('')}</div>
    </section>`;
}

// ───────────────────────── 매칭 신청 ─────────────────────────

async function renderApply(alive) {
  setTop({ title: '매칭 신청', back: '#/home' });
  setTabs(null);
  loading();
  const state = await api('/me');
  if (!alive()) return;
  const { user } = state;
  // 스터디 날짜(화·수·목)마다 18~21시 중 1시간 칸을 여러 개 고른다.
  // 이미 시작한 칸, 이미 신청·매칭한 칸은 고를 수 없다.
  const period = OPTIONS.studyPeriod;
  const taken = myTimetable(state);
  const studyDays = period.dates.map((date) => {
    const day = new Date(`${date}T00:00:00`).getDay() || 7;
    const time = period.times?.[date] ?? period;
    const slots = OPTIONS.timeSlots
      .map((sl, i) => ({ ...sl, i }))
      .filter((sl) => toMinutes(sl.start) >= toMinutes(time.start) && toMinutes(sl.end) <= toMinutes(time.end))
      .map((sl) => {
        const cell = `${day}-${sl.i}`;
        const past = new Date(`${date}T00:00:00+09:00`).getTime() + toMinutes(sl.start) * 60000 <= Date.now();
        const busy = taken.get(cell)?.kind === 'match' ? '매칭됨' : taken.get(cell)?.kind === 'pending' ? '신청함' : null;
        return { cell, label: `${Number(sl.start.slice(0, 2))}–${Number(sl.end.slice(0, 2))}시`, disabled: past || !!busy, note: past ? '지남' : busy };
      });
    return { date, day, slots };
  });
  const form = { locations: new Set(), styles: new Set(), cells: new Set() };

  view.innerHTML = `
    <section class="card">
      <div class="card-head"><h2>${icon('user')}내 프로필</h2><a class="link" href="#/me/edit">수정하기${icon('caret-right')}</a></div>
      <div class="profile">
        ${avatarHTML(user)}
        <div>
          <div class="name">${esc(user.name)}</div>
          <div class="tags">${user.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('') || '<span class="small muted">태그를 추가하면 메이트가 나를 더 잘 알 수 있어요</span>'}</div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>${icon('calendar-blank')}공부 일정 및 장소 설정</h2></div>
      <div class="field"><span>공부할 날짜와 시간 <small class="muted">· 1시간 단위, 여러 칸 선택</small></span>
        <div class="slot-stack" id="slots">
          ${studyDays.map((d) => `
            <div class="slot-day">
              <div class="slot-date"><b>${WD[d.day]}</b><small>${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8))}</small></div>
              <div class="slot-chips">
                ${d.slots.map((sl) => `
                  <button type="button" data-cell="${sl.cell}" aria-pressed="false"${sl.disabled ? ' disabled' : ''}>
                    <b>${sl.label}</b>${sl.note ? `<small>${esc(sl.note)}</small>` : ''}
                  </button>`).join('')}
              </div>
            </div>`).join('')}
        </div>
        <p class="tiny muted">메이트와 겹치는 시간이 약속이 돼요. 넓게 고를수록 매칭이 잘 돼요.</p>
      </div>
      <div class="field"><span>장소 설정 <small class="muted">· 중복 선택 가능</small></span>
        <div class="style-picker" id="loc" style="grid-template-columns:repeat(2, 1fr)">
          ${OPTIONS.locations.map((l) => {
            const [, name, sub] = l.match(/^(.*?)\s*\((.*)\)$/) ?? [null, l, ''];
            return `<button type="button" data-loc="${esc(l)}" aria-pressed="false"><b>${esc(name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</button>`;
          }).join('')}
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>${icon('book-open')}공부 스타일 선택</h2><span class="hint">중복 선택 가능</span></div>
      <div class="style-picker" id="styles">
        ${Object.entries(OPTIONS.styles).map(([k, s], i) => `
          <button type="button" data-style="${k}" aria-pressed="false">
            <b>${'ABC'[i]}. ${esc(s.label)}</b><small>${esc(s.desc)}</small>
          </button>`).join('')}
      </div>
    </section>

    ${OPTIONS.deposits ? `
    <section class="card">
      <div class="card-head"><h2>${icon('wallet')}약속 보증금 (선택)</h2><span class="hint">계좌이체</span></div>
      <div class="style-picker" id="deposit" style="grid-template-columns:repeat(4, 1fr)">
        ${[0, ...OPTIONS.deposits.options].map((v) => `
          <button type="button" data-deposit="${v}" aria-pressed="${v === 0}"><b>${v ? `${won(v)}원` : '없음'}</b></button>`).join('')}
      </div>
      <ul class="rules tiny muted">
        <li>약속을 모두 지키면 전액 돌려받아요.</li>
        <li>못 지키고 메이트는 지켰다면 메이트에게 보상으로 전달돼요.</li>
        <li>둘 다 못 지키면 돌려받을 수 없어요 (운영진에게 귀속). 중간에 그만두면 메이트에게 전달돼요.</li>
        <li>보증금을 건 사람끼리만 매칭되고, 금액이 다르면 낮은 쪽에 맞춰 차액을 돌려드려요.</li>
      </ul>
      <div id="refund-fields" hidden>
        <p class="small mt"><b>돌려받을 계좌</b> <span class="tiny muted">(운영진만 볼 수 있어요)</span></p>
        <div class="row" style="gap:8px">
          <label class="field" style="flex:1"><span>은행</span><input class="input" id="refund-bank" maxlength="20" placeholder="국민은행" value="${esc(user.refund?.bank ?? '')}"></label>
          <label class="field" style="flex:1"><span>예금주</span><input class="input" id="refund-holder" maxlength="20" value="${esc(user.refund?.holder ?? user.name)}"></label>
        </div>
        <label class="field"><span>계좌번호</span><input class="input" id="refund-account" inputmode="numeric" maxlength="30" placeholder="숫자와 - 만" value="${esc(user.refund?.account ?? '')}"></label>
        <label class="field"><span>입금자명 (보낼 때 표시되는 이름)</span><input class="input" id="depositor" maxlength="20" value="${esc(user.name)}"></label>
      </div>
    </section>` : ''}

    <div class="sticky-cta"><button class="btn primary block" id="submit">매칭 신청하기</button></div>`;

  let deposit = 0;
  $('#deposit')?.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    deposit = Number(b.dataset.deposit);
    $$('#deposit button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    $('#refund-fields').hidden = !deposit;
  });

  $('#styles').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const s = b.dataset.style;
    form.styles.has(s) ? form.styles.delete(s) : form.styles.add(s);
    b.setAttribute('aria-pressed', form.styles.has(s));
  });
  $('#slots').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const c = b.dataset.cell;
    form.cells.has(c) ? form.cells.delete(c) : form.cells.add(c);
    b.setAttribute('aria-pressed', form.cells.has(c));
  });
  // 장소는 여러 개 고를 수 있다 (겹치는 장소로 매칭, 둘 다 겹치면 강의실 우선)
  $('#loc').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const l = b.dataset.loc;
    form.locations.has(l) ? form.locations.delete(l) : form.locations.add(l);
    b.setAttribute('aria-pressed', form.locations.has(l));
  });

  $('#submit').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      // 바로 매칭되더라도 메이트를 찾는 화면을 3초 동안 보여 준다
      const body = { cells: [...form.cells], locations: [...form.locations], styles: [...form.styles] };
      if (deposit) {
        Object.assign(body, {
          deposit,
          depositor: $('#depositor').value,
          refund: { bank: $('#refund-bank').value, account: $('#refund-account').value, holder: $('#refund-holder').value },
        });
      }
      const res = await withLoading(deposit ? '신청을 저장하는 중이에요' : '메이트를 찾는 중이에요',
        () => api('/requests', { method: 'POST', body }), deposit ? 800 : 3000);
      if (res.awaitingDeposit) {
        const modal = $('#modal');
        modal.innerHTML = `
          <div class="sheet">
            <h3>보증금을 보내 주세요</h3>
            <p class="small muted">아래 계좌로 입금하면 운영진이 확인한 뒤 메이트 찾기를 시작해요.</p>
            ${depositGuide(res.request.deposit, res.request.depositor)}
            <button class="btn primary block mt" id="dep-ok">확인했어요</button>
          </div>`;
        modal.hidden = false;
        $('#dep-ok').addEventListener('click', () => { closeModal(); location.hash = '#/home'; });
        return;
      }
      if (res.matchId) {
        toast('바로 메이트를 찾았어요!');
        location.hash = `#/match/${res.matchId}`;
      } else {
        toast('신청 완료! 조건이 맞는 메이트를 기다리는 중이에요.');
        location.hash = '#/home';
      }
    } catch (err) {
      toast(err.message, true);
      e.target.disabled = false;
    }
  });
}

// ───────────────────────── 매칭중 ─────────────────────────

const STATUS_PILL = {
  done: '<span class="pill">출석</span>',
  studying: '<span class="pill lime">공부중</span>',
  missed: '<span class="pill red">미참석</span>',
  open: '<span class="pill lime">출석 가능</span>',
  scheduled: '<span class="pill gray">예정</span>',
  cancelled: '<span class="pill gray">취소</span>',
};
const MARK = {
  done: [icon('check'), '출석'], studying: [icon('check'), '공부중'], missed: [icon('x'), '미참석'],
  open: ['', '예정'], scheduled: ['', '예정'], off: ['–', '휴식'], cancelled: ['–', '취소'],
};

// 메이트가 여럿이면 화면 위에 메이트 고르는 버튼을 보여 준다
let mateTabs = '';
const mateTabsHTML = (matches, current, base) => (matches.length < 2 ? '' : `
  <div class="mate-tabs">${matches.map((m) => `
    <a href="#/${base}/${m.id}" class="${m.id === current ? 'on' : ''}">${esc(m.mate.avatar)} ${esc(m.mate.name)}<small>${esc(scheduleText(m.schedule))}</small></a>`).join('')}
  </div>`);

async function renderMatch(alive, id) {
  setTop({ title: '매칭중' });
  setTabs('match');
  loading();
  const { matches } = await api('/matches/active');
  if (!alive()) return;
  const match = matches.find((m) => m.id === id) ?? matches[0];
  mateTabs = mateTabsHTML(matches, match?.id, 'match');
  if (!match) {
    view.innerHTML = `
      <div class="empty">
        <div class="em">${icon('plant')}</div>
        <h3>진행 중인 매칭이 없어요</h3>
        <p>매칭을 신청하면 1주일 동안 함께할 메이트를 찾아드려요.</p>
        <a class="btn primary mt-lg" href="#/home">홈으로</a>
      </div>`;
    return;
  }
  if (match.status === 'reported') return renderReport(match, alive);
  drawMatch(match, alive);
}

function drawMatch(m, alive) {
  const today = todayStr();
  const tabs = mateTabs;
  const target = m.appointments.find((a) => a.me.status === 'studying' || a.mate.status === 'studying')
    ?? m.appointments.find((a) => a.me.status === 'open' || a.mate.status === 'open');
  const next = m.appointments.find((a) => a.me.status === 'scheduled');

  // 현장 출석 확인: 내 코드는 메이트가 입력해서 내 출석을 확인해 주고, 나는 메이트의 코드를 입력해서 메이트 출석을 확인한다.
  let checkin;
  if (target) {
    const meIn = ['studying', 'done'].includes(target.me.status);
    const mateIn = ['studying', 'done'].includes(target.mate.status);
    const myPart = meIn
      ? (target.me.status === 'studying' ? `
        <div class="center">
          <p class="small muted">${icon('check', 'l')}메이트가 내 출석을 확인했어요</p>
          <div class="timer mt" id="timer" data-since="${esc(target.me.checkedInAt)}">00:00:00</div>
          <p class="tiny muted">공부 시간 기록 중</p>
          <button class="btn primary block mt" id="checkout" data-id="${target.id}">공부 종료하고 기록하기</button>
        </div>` : `<p class="small">${icon('check', 'l')}오늘 내 출석 완료 · 공부 기록을 마쳤어요</p>`)
      : `
        <div class="checkin">
          <div>
            <p class="small"><b>내 출석 코드</b></p>
            <div class="code">${esc(target.myCode ?? '')}</div>
            <p class="tiny muted mt">메이트가 이 QR을 찍으면 내 출석이 바로 확인돼요. QR이 안 되면 이 코드를 알려 주세요.</p>
          </div>
          <div class="qr-box"><img data-qr="${target.id}" alt="내 출석 QR 코드"></div>
        </div>`;
    const matePart = mateIn
      ? `<p class="small">${icon('check', 'l')}${esc(m.mate.name)}님 출석 확인 완료</p>`
      : `
        <p class="small"><b>${esc(m.mate.name)}님 출석 확인하기</b></p>
        <p class="tiny muted">메이트 화면의 QR을 찍으면 메이트 출석이 바로 확인돼요.</p>
        <button class="btn primary block mt" id="scan" data-id="${target.id}">메이트 QR 찍기</button>
        <p class="tiny muted mt">QR이 안 되면 메이트 화면의 출석 코드를 입력해 주세요.</p>
        ${target.mateCode ? `<p class="tiny muted">데모 메이트 코드: <b class="code" style="font-size:12px">${esc(target.mateCode)}</b></p>` : ''}
        <form class="row mt" id="confirm-form" data-id="${target.id}">
          <input class="input code" name="code" maxlength="6" placeholder="메이트 코드" autocomplete="off" style="text-transform:uppercase" required>
          <button class="btn inline-btn">확인</button>
        </form>`;
    checkin = `
      <p class="tiny muted">${fmtDate(target.date, true)} ${fmtTime(target.startTime)} ~ ${fmtTime(target.endTime)} 약속</p>
      <div class="att-part">${myPart}</div>
      <div class="att-part">${matePart}</div>`;
  } else if (next) {
    checkin = `<div class="notice" style="margin-top:0">${icon('clock')}<span>다음 약속은 <b>${fmtDate(next.date, true)} ${fmtTime(next.startTime)}</b>이에요. 시작 ${OPTIONS.checkinEarlyMin}분 전부터 출석할 수 있어요.</span></div>`;
  } else {
    checkin = `<div class="notice" style="margin-top:0">${icon('check-circle')}<span>이번 주 약속이 모두 끝났어요. 주간이 끝나면 리포트가 도착해요.</span></div>`;
  }

  const weekRow = (who) => m.week.map((d) => {
    const st = d[who];
    const [sym, label] = MARK[st];
    return `<div class="d${d.date === today ? ' today' : ''}">
      <b>${WD[d.weekday]}</b><span class="muted">${Number(d.date.slice(8))}일</span>
      <div class="mark ${st}">${sym}</div><span class="tiny">${label}</span>
    </div>`;
  }).join('');

  view.innerHTML = `${tabs}
    <section class="card">
      <div class="card-head"><h2>${icon('users')}메이트 프로필</h2><span class="pill">${m.round}주차</span></div>
      <div class="profile">
        ${avatarHTML(m.mate, 'lg')}
        <div>
          <div class="name">${esc(m.mate.name)}${botBadge(m.mate)}</div>
          ${m.mate.bio ? `<div class="small muted">${esc(m.mate.bio)}</div>` : ''}
          <div class="tags">${m.mate.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        </div>
      </div>
      ${m.mate.isBot ? `<div class="notice">${icon('robot')}<span>체험용 <b>가상 메이트</b>예요. 실제로 약속 장소에 나오지 않아요. 내가 출석하면 함께 출석하고, 채팅에 자동으로 답해요.</span></div>` : ''}
      <div class="notice">
        ${icon('handshake')}
        <span>${esc(styleLabels(m.styles))} · ${esc(m.location)}${m.stake ? ` · 보증금 ${won(m.stake)}원` : ''}</span>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>${icon('calendar-blank')}예정된 약속</h2><span class="hint">${fmtDate(m.weekStart)} ~ ${fmtDate(m.weekEnd)}</span></div>
      ${m.appointments.length ? m.appointments.map((a) => `
        <div class="appt${a.id === target?.id ? ' is-open' : ''}">
          <div class="date"><b>${fmtDate(a.date)}</b><span>(${WD[a.weekday]})</span></div>
          <div class="meta">
            <div>${icon('clock')}${fmtTime(a.startTime)} ~ ${fmtTime(a.endTime)}</div>
            <div class="muted">${icon('map-pin')}${esc(a.location)}</div>
          </div>
          <div>${STATUS_PILL[a.me.status]}</div>
        </div>`).join('') : '<p class="small muted">이번 주 약속이 없어요.</p>'}
    </section>

    <section class="card">
      <div class="card-head"><h2>${icon('qr-code')}현장 출석 확인</h2></div>
      ${checkin}
    </section>

    <section class="card">
      <div class="card-head"><h2>${icon('chart-bar')}이번주 출석</h2></div>
      <div class="stat-grid">
        <div class="stat"><b>${m.stats.me.attended}/${m.stats.me.total}</b><span>내 출석</span></div>
        <div class="stat"><b>${fmtMinutes(m.stats.me.minutes)}</b><span>내 공부시간</span></div>
        <div class="stat"><b>${m.stats.mate.attended}/${m.stats.mate.total}</b><span>메이트 출석</span></div>
      </div>
      <div class="week-label">나</div>
      <div class="week">${weekRow('me')}</div>
      <div class="week-label">${esc(m.mate.name)}</div>
      <div class="week">${weekRow('mate')}</div>
    </section>

    ${OPTIONS.demo ? `
      <div class="demo-bar">
        <b>데모 모드</b> · 시간과 상관없이 출석할 수 있고, 주간을 바로 마감해 리포트를 볼 수 있어요.
        <button class="btn sm block mt" id="settle">이번 주 마감하고 리포트 받기</button>
      </div>` : ''}

    <div class="leave-box">
      <button class="btn ghost block danger" id="leave">매칭 그만두기</button>
      <p class="tiny muted center">${esc(LEAVE_HINT[m.leavePolicy]?.(m) ?? '')}</p>
    </div>`;

  $$('img[data-qr]').forEach(async (img) => {
    const id = img.dataset.qr;
    img.src = window.__mockQr ? await window.__mockQr(Number(id)).catch(() => '') : `/api/appointments/${id}/qr`;
    // 누르면 메이트가 찍기 쉽게 크게 보여 준다 (아무 데나 누르면 닫힘)
    img.addEventListener('click', () => {
      const modal = $('#modal');
      modal.innerHTML = `
        <div class="qr-zoom">
          <img src="${img.src}" alt="내 출석 QR 코드 (크게)">
          <div class="code">${esc(target.myCode ?? '')}</div>
          <p class="tiny muted">메이트에게 이 QR을 찍게 해 주세요 · 화면을 누르면 닫혀요</p>
        </div>`;
      modal.hidden = false;
      modal.onclick = closeModal;
    });
  });

  const timer = $('#timer');
  if (timer) {
    const since = new Date(timer.dataset.since).getTime();
    const tick = () => {
      const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
      timer.textContent = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
    };
    tick();
    every(1000, tick);
  }

  const refresh = (match) => {
    if (!alive()) return;
    timers.forEach(clearInterval);
    timers = [];
    match.status === 'reported' ? renderReport(match, alive) : drawMatch(match, alive);
  };

  const confirmMate = async (id, code) => {
    try {
      const res = await api(`/appointments/${id}/confirm`, { method: 'POST', body: { code } });
      toast(`${m.mate.name}님 출석을 확인했어요. 함께 시작해요.`);
      refresh(res.match);
    } catch (err) { toast(err.message, true); }
  };
  $('#confirm-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    confirmMate(e.target.dataset.id, e.target.code.value);
  });
  $('#scan')?.addEventListener('click', (e) => openScanner(Number(e.target.dataset.id), refresh));
  $('#checkout')?.addEventListener('click', async (e) => {
    try {
      const res = await api(`/appointments/${e.target.dataset.id}/checkout`, { method: 'POST' });
      toast(`수고했어요! ${fmtMinutes(res.minutes)} 공부를 기록했어요.`);
      refresh(res.match);
    } catch (err) { toast(err.message, true); }
  });
  $('#leave')?.addEventListener('click', async () => {
    if (!confirm(LEAVE_CONFIRM[m.leavePolicy](m))) return;
    try {
      const res = await api(`/matches/${m.id}/leave`, { method: 'POST' });
      if (res.result === 'settled') {
        toast('이번 주를 정산했어요. 리포트를 확인해 주세요.');
        router();
        return;
      }
      toast(!res.stake ? '매칭을 그만뒀어요.'
        : res.lostTo === 'mate' ? `매칭을 그만뒀어요. 보증금 ${won(res.stake)}원은 메이트에게 전달돼요.`
          : `매칭을 그만뒀어요. 보증금 ${won(res.stake)}원은 돌려받지 못해요.`);
      location.hash = '#/home';
    } catch (err) { toast(err.message, true); }
  });
  $('#settle')?.addEventListener('click', async () => {
    if (!confirm('이번 주를 마감하고 보증금을 정산할까요?')) return;
    try {
      const res = await api(`/matches/${m.id}/settle`, { method: 'POST' });
      refresh(res.match);
    } catch (err) { toast(err.message, true); }
  });
}

// 매칭 그만두기 규칙 안내 (server/service.js leavePolicy 와 같은 규칙)
const LEAVE_HINT = {
  penalty: (m) => (m.stake ? '지금 그만두면 내 보증금은 돌려받을 수 없어요.' : '지금 그만두면 이번 주 매칭이 바로 끝나요.'),
  settle: () => '남은 약속이 없어서, 지금까지 출석으로 이번 주를 정산해요.',
};
const LEAVE_CONFIRM = {
  penalty: (m) => (m.stake
    ? '정말 매칭을 그만둘까요?\n\n내 보증금은 돌려받을 수 없어요.'
    : `정말 매칭을 그만둘까요?\n\n${m.mate.name}님과의 이번 주 매칭이 바로 끝나요.`),
  settle: () => '남은 약속이 없어요. 지금까지 출석으로 이번 주를 정산하고 리포트를 받을까요?',
};

const DEPOSIT_TEXT = {
  none: () => '보증금 없이 진행했어요.',
  refunded: (n) => `약속을 지켜 보증금 ${won(n)}원을 돌려받았어요.`,
  to_mate: (n) => `약속을 지키지 못해 보증금 ${won(n)}원이 메이트에게 전달됐어요.`,
  forfeited: (n) => `둘 다 약속을 지키지 못해 보증금 ${won(n)}원은 돌려받을 수 없어요. (운영진 귀속)`,
};
const PAYOUT_NOTE = '돌려받을 돈과 보상은 운영진이 등록한 계좌로 이체해요. 진행 상황은 마이페이지에서 볼 수 있어요.';

function renderReport(m, alive) {
  setTop({ title: '주간 리포트' });
  const { me, mate } = m.report;
  const col = (who, r, name) => `
    <div class="col">
      <div class="small muted">${esc(name)}</div>
      <div class="big">${r.rate}%</div>
      <div class="tiny muted">출석 ${r.attended}/${r.total}</div>
      <div class="bar"><i style="width:${r.rate}%"></i></div>
      <div class="small mt"><b>${fmtMinutes(r.minutes)}</b></div>
      <div class="tiny muted">공부시간</div>
    </div>`;

  let choice;
  if (m.myChoice === 'continue') {
    choice = `<div class="notice">${icon('hourglass-medium')}<span>${esc(m.mate.name)}님의 선택을 기다리고 있어요. 둘 다 '계속하기'를 고르면 다음 주 약속이 바로 만들어져요.</span></div>`;
  } else {
    choice = `
      <p class="small muted">${m.mateChoice === 'continue' ? `${esc(m.mate.name)}님은 계속하고 싶어해요.` : '다음 주는 어떻게 할까요?'}</p>
      <div class="stack mt">
        <button class="btn primary block" data-choice="continue">${esc(m.mate.name)}님과 계속하기</button>
        <button class="btn block" data-choice="new">새 메이트 만나기</button>
      </div>`;
  }

  view.innerHTML = `${mateTabs}
    <section class="card hero">
      <div class="small muted">${fmtDate(m.weekStart)} ~ ${fmtDate(m.weekEnd)} · ${m.round}주차</div>
      <h2 style="font-size:20px;margin-top:4px">${me.kept ? '이번 주 약속을 모두 지켰어요' : '이번 주는 아쉬웠어요'}</h2>
    </section>

    <section class="card">
      <div class="card-head"><h2>${icon('chart-line-up')}출석률과 공부시간</h2></div>
      <div class="vs">${col('me', me, '나')}${col('mate', mate, m.mate.name)}</div>
    </section>

    ${me.deposit.result !== 'none' ? `
    <section class="card">
      <div class="card-head"><h2>${icon('wallet')}보증금 정산</h2></div>
      <p class="small">${DEPOSIT_TEXT[me.deposit.result](me.deposit.amount)}</p>
      ${me.reward ? `<p class="small mt"><span class="plus">+${won(me.reward)}원</span> 메이트의 미이행 보상을 받아요.</p>` : ''}
      <p class="tiny muted mt">${PAYOUT_NOTE}</p>
    </section>` : ''}

    <section class="card">
      <div class="card-head"><h2>${icon('repeat')}다음 주 선택</h2></div>
      ${choice}
    </section>`;

  $$('[data-choice]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const res = await api(`/matches/${m.id}/choice`, { method: 'POST', body: { choice: b.dataset.choice } });
      if (res.next === 'continue') {
        toast(`${m.mate.name}님과 다음 주도 함께해요!`);
        router();
      } else if (res.next === 'new') {
        toast('새 메이트를 찾아볼까요?');
        location.hash = '#/apply';
      } else {
        toast('선택을 저장했어요.');
        router();
      }
    } catch (err) { toast(err.message, true); }
  }));

  if (m.myChoice === 'continue') {
    every(4000, async () => {
      const res = await api('/matches/current').catch(() => null);
      if (!alive() || !res) return;
      if (!res.match || res.match.id !== m.id) router();
    });
  }
}

// ───────────────────────── 지난 스터디 다시 보기 ─────────────────────────

const PAST_DEPOSIT = {
  none: () => '보증금 없이 진행했어요.',
  refunded: (n) => `보증금 ${won(n)}원을 돌려받았어요.`,
  to_mate: (n) => `보증금 ${won(n)}원이 메이트에게 전달됐어요.`,
  forfeited: (n) => `둘 다 약속을 지키지 못해 보증금 ${won(n)}원은 운영진에게 귀속됐어요.`,
};

async function renderPast(alive, id) {
  setTop({ title: '지난 스터디', back: '#/me' });
  setTabs('me');
  loading();
  const { match: m } = await api(`/matches/${id}`);
  if (!alive()) return;
  if (m.status !== 'closed') {
    location.hash = '#/match'; // 아직 진행 중인 매칭은 매칭중 화면에서
    return;
  }
  const r = m.report;
  const headline = m.headline ? m.headline : m.left === 'me' ? '내가 중간에 그만둔 스터디예요'
    : m.left === 'mate' ? `${m.mate.name}님이 중간에 그만둔 스터디예요`
    : r?.me?.kept ? '약속을 모두 지킨 주였어요' : '아쉬움이 남은 주였어요';

  const weekRow = (who) => m.week.map((d) => {
    const [sym, label] = MARK[d[who]];
    return `<div class="d"><b>${WD[d.weekday]}</b><span class="muted">${Number(d.date.slice(8))}일</span>
      <div class="mark ${d[who]}">${sym}</div><span class="tiny">${label}</span></div>`;
  }).join('');
  const col = (u, name) => `
    <div class="col">
      <div class="small muted">${esc(name)}</div>
      <div class="big">${u.rate}%</div>
      <div class="tiny muted">출석 ${u.attended}/${u.total}</div>
      <div class="bar"><i style="width:${u.rate}%"></i></div>
      <div class="small mt"><b>${fmtMinutes(u.minutes)}</b></div>
      <div class="tiny muted">공부시간</div>
    </div>`;

  view.innerHTML = `
    <section class="card hero">
      <div class="small muted">${fmtDate(m.weekStart)} ~ ${fmtDate(m.weekEnd)} · ${esc(m.label ?? `${m.round}주차`)} · ${esc(m.location)}</div>
      <h2 style="font-size:18px;margin-top:4px">${esc(headline)}</h2>
    </section>

    <section class="card">
      <div class="card-head"><h2>${icon('users')}메이트</h2></div>
      <div class="profile">
        ${avatarHTML(m.mate)}
        <div>
          <div class="name">${esc(m.mate.name)}${botBadge(m.mate)}</div>
          <div class="tags">${m.mate.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        </div>
      </div>
      <div class="notice">${icon('handshake')}<span>${esc(styleLabels(m.styles))}${m.stake ? ` · 보증금 ${won(m.stake)}원` : ''}</span></div>
    </section>

    ${r ? `
    <section class="card">
      <div class="card-head"><h2>${icon('chart-line-up')}출석률과 공부시간</h2></div>
      <div class="vs">${col(r.me, '나')}${col(r.mate, m.mate.name)}</div>
      ${r.me.deposit.result !== 'none' ? `<p class="small mt">${PAST_DEPOSIT[r.me.deposit.result](r.me.deposit.amount)}
        ${r.me.reward ? ` 보상으로 <span class="plus">+${won(r.me.reward)}원</span>을 받았어요.` : ''}</p>` : ''}
    </section>` : ''}

    <section class="card">
      <div class="card-head"><h2>${icon('calendar-blank')}약속</h2></div>
      ${m.appointments.map((a) => `
        <div class="appt">
          <div class="date"><b>${fmtDate(a.date)}</b><span>(${WD[a.weekday]})</span></div>
          <div class="meta"><div>${icon('clock')}${fmtTime(a.startTime)} ~ ${fmtTime(a.endTime)}</div>
            ${a.me.minutes ? `<div class="muted">공부 ${fmtMinutes(a.me.minutes)}</div>` : ''}</div>
          <div>${STATUS_PILL[a.me.status]}</div>
        </div>`).join('') || '<p class="small muted">약속이 없었어요.</p>'}
    </section>

    <section class="card">
      <div class="card-head"><h2>${icon('chart-bar')}출석</h2></div>
      <div class="week-label">나</div>
      <div class="week">${weekRow('me')}</div>
      <div class="week-label">${esc(m.mate.name)}</div>
      <div class="week">${weekRow('mate')}</div>
    </section>`;
}

// ───────────────────────── QR 스캐너 ─────────────────────────

function closeModal() {
  const modal = $('#modal');
  modal.dispatchEvent(new Event('close'));
  modal.hidden = true;
  modal.innerHTML = '';
  modal.onclick = null;
}

// 카메라 화면에서 QR 글자 읽기: 브라우저 기본 기능(BarcodeDetector)이 없으면(아이폰 등) jsQR로 읽는다.
let jsQrLoading = null;
const loadJsQr = () => (jsQrLoading ??= new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = 'vendor/jsQR.js';
  s.onload = () => resolve(window.jsQR);
  s.onerror = () => { jsQrLoading = null; reject(new Error('QR 인식 기능을 불러오지 못했어요.')); };
  document.head.append(s);
}));

async function qrReader(video) {
  if ('BarcodeDetector' in window) {
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    return async () => (await detector.detect(video).catch(() => [])).map((c) => c.rawValue);
  }
  const jsQR = await loadJsQr();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async () => {
    if (!video.videoWidth) return [];
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const hit = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    return hit ? [hit.data] : [];
  };
}

function openScanner(appointmentId, onDone) {
  const modal = $('#modal');
  const canScan = !!navigator.mediaDevices?.getUserMedia;
  modal.innerHTML = `
    <div class="sheet">
      <div class="row between"><h3>메이트 QR 찍기</h3><button class="btn sm ghost" id="close">닫기</button></div>
      <p class="small muted">메이트 화면의 출석 QR을 비추면 바로 출석이 확인돼요. 안 되면 아래에 메이트의 코드를 입력하세요.</p>
      ${canScan ? '<div class="scanner"><video id="video" playsinline muted></video></div>' : '<div class="notice">이 브라우저는 카메라를 쓸 수 없어요. 메이트 화면의 6자리 코드를 입력해 주세요.</div>'}
      <form id="code-form" class="row mt">
        <input class="input code" name="code" maxlength="6" placeholder="메이트 코드" autocomplete="off" style="text-transform:uppercase" required>
        <button class="btn primary">출석 확인</button>
      </form>
    </div>`;
  modal.hidden = false;

  let stream = null;
  let stopped = false;
  const stop = () => {
    stopped = true;
    stream?.getTracks().forEach((t) => t.stop());
  };
  modal.addEventListener('close', stop, { once: true });
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  $('#close').addEventListener('click', closeModal);

  const submit = async (code) => {
    try {
      const res = await api(`/appointments/${appointmentId}/confirm`, { method: 'POST', body: { code } });
      closeModal();
      toast('메이트 출석을 확인했어요. 함께 시작해요.');
      onDone(res.match);
      return true;
    } catch (err) {
      toast(err.message, true);
      return false;
    }
  };

  $('#code-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submit(new FormData(e.target).get('code'));
  });

  if (canScan) {
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) return stop();
        const video = $('#video');
        video.srcObject = stream;
        await video.play();
        const read = await qrReader(video);
        const loop = async () => {
          if (stopped) return;
          const hit = (await read()).find((v) => v.startsWith('SB:'));
          // 읽었는데 확인에 실패하면(시간 전 등) 잠깐 쉬었다가 다시 찍을 수 있게 한다
          if (hit && await submit(hit.split(':')[2])) return;
          if (hit) return setTimeout(loop, 2000);
          requestAnimationFrame(loop);
        };
        loop();
      } catch {
        toast('카메라를 사용할 수 없어요. 코드를 입력해 주세요.', true);
      }
    })();
  }
}

// ───────────────────────── 채팅 ─────────────────────────

async function renderChat(alive, id) {
  setTop({ title: '채팅' });
  setTabs('chat');
  loading();
  const [{ matches }, { user }] = await Promise.all([api('/matches/active'), api('/me')]);
  if (!alive()) return;
  const match = matches.find((m) => m.id === id) ?? matches[0];
  if (!match) {
    view.innerHTML = `
      <div class="empty"><div class="em">${icon('chat-circle')}</div><h3>대화할 메이트가 없어요</h3>
      <p>매칭이 되면 메이트와 약속을 이야기할 수 있어요.</p></div>`;
    return;
  }
  setTop({ title: `${match.mate.avatar} ${match.mate.name}` });
  const quick = quickMessages(match);
  view.innerHTML = `${mateTabsHTML(matches, match.id, 'chat')}
    <div class="notice">${icon('map-pin')}<span>${esc(match.location)} · ${esc(scheduleText(match.schedule))}</span></div>
    <p class="tiny muted center mt">신고·분쟁이 있을 때 운영진이 대화 기록을 확인할 수 있어요.</p>
    <div class="chat mt" id="chat"></div>
    <div class="chat-dock">
      <div class="quick">
        <div class="quick-head"><b>${icon('lightning', 'l')}메이트 빠른 연락</b><span>원클릭 알림</span></div>
        <div class="quick-list" id="quick">
          ${quick.map((q, i) => `
            <button type="button" class="quick-card" data-i="${i}">
              <span class="quick-icon">${icon(q.icon)}</span>
              <span class="quick-text"><b>${esc(q.title)}</b><small>"${esc(q.body)}"</small></span>
            </button>`).join('')}
        </div>
      </div>
      <form class="chat-input" id="send">
        ${OPTIONS.photos ? `<label class="btn photo-btn" title="사진 보내기" aria-label="사진 보내기">${icon('camera')}<input type="file" id="photo-input" accept="image/*" hidden></label>` : ''}
        <input class="input" name="body" maxlength="500" placeholder="메시지를 입력하세요" autocomplete="off">
        <button class="btn primary">전송</button>
      </form>
    </div>`;

  const box = $('#chat');
  // 하단 빠른 연락 + 입력창 높이만큼 비워 두어 마지막 메시지가 가려지지 않게 한다.
  box.style.paddingBottom = `${$('.chat-dock').offsetHeight + 16}px`;
  let lastId = 0;
  let inflight = null;
  const toBottom = () => scroller().scrollTo(0, scroller().scrollHeight);
  const load = () => (inflight ??= (async () => {
    try {
      const { messages } = await api(`/matches/${match.id}/messages?after=${lastId}`);
      if (!alive() || !messages.length) return;
      $('#hello')?.remove();
      for (const msg of messages) {
        if (msg.id <= lastId) continue;
        lastId = msg.id;
        box.insertAdjacentHTML('beforeend', bubbleHTML(msg, msg.userId === user.id ? 'me' : 'mate'));
      }
      $$('img.chat-photo', box).forEach((img) => { if (!img.complete) img.onload = toBottom; });
      toBottom();
    } finally {
      inflight = null;
    }
  })());
  box.addEventListener('click', (e) => {
    const img = e.target.closest('img.chat-photo');
    if (img) zoomPhoto(img.src);
  });
  await load();
  if (!box.children.length) box.innerHTML = `<p class="center small muted" id="hello">${esc(match.mate.name)}님께 먼저 인사해 보세요.</p>`;

  // 실시간: 새 메시지 신호가 오면 바로 가져온다. 연결이 안 되면 3초마다 확인 (연결돼 있어도 15초마다 한 번 확인)
  let live = false;
  let lastPoll = Date.now();
  connectRealtime(match.id, () => load().catch(() => {}), (ok) => { live = ok; }, alive);
  every(3000, () => {
    if (live && Date.now() - lastPoll < 15000) return;
    lastPoll = Date.now();
    load().catch(() => {});
  });

  $('#photo-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const photo = await compressImage(file);
      await withLoading('사진을 보내는 중이에요', () => api(`/matches/${match.id}/photos`, { method: 'POST', body: { photo } }), 300);
      await load();
    } catch (err) { toast(err.message, true); }
  });

  const send = (body) => api(`/matches/${match.id}/messages`, { method: 'POST', body: { body } }).then(load);

  $('#send').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.body;
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    try {
      await send(body);
    } catch (err) {
      toast(err.message, true);
      input.value = body;
    }
  });

  $('#quick').addEventListener('click', async (e) => {
    const card = e.target.closest('.quick-card');
    if (!card || card.disabled) return;
    const q = quick[Number(card.dataset.i)];
    card.disabled = true;
    try {
      await send(q.body);
      toast(`${match.mate.name}님께 알림을 보냈어요.`);
    } catch (err) {
      toast(err.message, true);
    } finally {
      card.disabled = false;
    }
  });
}

// 채팅 말풍선 (글 또는 사진)
function bubbleHTML(msg, side, name = '') {
  const t = new Date(msg.createdAt);
  const time = `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`;
  const content = msg.photoId
    ? `<img class="chat-photo" src="/api/photos/${msg.photoId}" alt="보낸 사진" loading="lazy">`
    : esc(msg.body);
  return `<div class="bubble ${side}${msg.photoId ? ' has-photo' : ''}">${name ? `<b class="who">${esc(name)}</b>` : ''}${content}<time>${time}</time></div>`;
}

// 실시간 채팅 연결 (Supabase Realtime). 설정이 없거나 실패하면 onStatus(false) 로 두고 3초 확인을 계속한다.
let supabaseLoading = null;
const loadSupabase = () => (supabaseLoading ??= new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = 'vendor/supabase.js';
  s.onload = () => resolve(window.supabase);
  s.onerror = () => { supabaseLoading = null; reject(new Error('실시간 기능을 불러오지 못했어요.')); };
  document.head.append(s);
}));
let realtimeClient = null;
async function connectRealtime(matchId, onMessage, onStatus, alive) {
  if (!OPTIONS.realtime) return;
  try {
    const [{ topic }, lib] = await Promise.all([api(`/matches/${matchId}/realtime`), loadSupabase()]);
    if (!topic || !alive()) return;
    realtimeClient ??= lib.createClient(OPTIONS.realtime.url, OPTIONS.realtime.anonKey, { auth: { persistSession: false } });
    const channel = realtimeClient.channel(topic)
      .on('broadcast', { event: 'new' }, () => onMessage())
      .subscribe((status) => {
        onStatus(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') onMessage(); // 연결되는 사이에 온 메시지
      });
    onLeave(() => { onStatus(false); realtimeClient.removeChannel(channel); });
  } catch {
    onStatus(false);
  }
}

// 채팅 '메이트 빠른 연락' 원클릭 메시지
function quickMessages(match) {
  return [
    { icon: 'person-simple-walk', title: '도착 완료 알림', body: `${match.location}에 도착했어요! 먼저 자리 잡고 있을게요.` },
    { icon: 'clock', title: '5분 지연 양해', body: '5분 정도 늦을 것 같아요. 죄송해요, 금방 갈게요!' },
    { icon: 'coffee', title: '쉬는 시간 제안', body: '잠깐 10분 쉬었다 할까요?' },
    { icon: 'hand-waving', title: '오늘 수고 인사', body: '오늘도 같이 공부해서 좋았어요. 수고 많으셨어요!' },
  ];
}

// ───────────────────────── 운영자 화면 ─────────────────────────
// 입금 확인 · 환급/보상 이체 · 인증 메일 도움 요청 · 메일 발송 기록 · 매칭별 채팅 기록

const ADMIN_TABS = [['stats', '현황'], ['money', '돈'], ['help', '메일'], ['chats', '채팅']];
let adminTab = 'stats';

// ISO 시각 → 한국 시간 "11/4 23:12"
function fmtAt(s) {
  if (!s) return '-';
  const d = new Date(new Date(s).getTime() + 9 * 3600000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

// 현황 탭: 전환 단계 · 방문 · 가입자 · 인증메일 · 신청 · 매칭 (채팅은 열람 기록이 남는 '채팅' 탭에서)
function adminStatsHTML(a) {
  const STATUS = { pending: '대기', awaiting_deposit: '입금 대기', matched: '매칭됨', cancelled: '취소', active: '진행 중', reported: '리포트 대기', closed: '끝남' };
  const shortDay = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8))}`;
  const maxHour = Math.max(1, ...a.visits.byHour);
  return `
    <section class="card">
      <div class="card-head"><h2>${icon('funnel')}전환 단계</h2><button type="button" class="btn sm" id="funnel-today" aria-pressed="false">오늘만 보기</button></div>
      <div id="funnel">${funnelHTML(a.funnel.all)}</div>
      <p class="tiny muted mt">사람 수 기준이에요. 방문은 11/4부터 기록해서, 그 전에 가입한 사람은 방문 수에 없어요.</p>
    </section>
    <section class="card">
      <div class="card-head"><h2>${icon('eye')}방문 통계</h2><span class="hint">총 ${a.visits.total}번 방문</span></div>
      <p class="small">지금까지 들어온 사람 <b>${a.visits.people}명</b></p>
      <p class="small muted mt">날짜별 들어온 사람</p>
      ${a.visits.byDay.map((d) => `<div class="list-item"><span>${shortDay(d.day)}</span><span><b>${d.people}명</b> <span class="tiny muted">· ${d.visits}번</span></span></div>`).join('') || '<p class="small muted">아직 기록이 없어요.</p>'}
      <p class="small muted mt">시간대별 방문 (한국 시간)</p>
      <div class="hour-bars">
        ${a.visits.byHour.map((v, h) => `<div title="${h}시 ${v}번"><i style="height:${(v / maxHour) * 100}%"></i><span>${h % 3 === 0 ? h : ''}</span></div>`).join('')}
      </div>
      <details class="mt"><summary class="small">같은 사람의 시간대별 방문 보기</summary>
        ${a.visits.perVisitor.map((p) => `<div class="list-item"><span>방문자${p.visitor} · ${shortDay(p.day)}</span><span class="tiny">${Object.entries(p.hours).map(([h, n]) => `${h}시 ${n}번`).join(', ')}</span></div>`).join('')}
      </details>
    </section>
    <section class="card">
      <div class="card-head"><h2>${icon('users')}가입자</h2><span class="hint">${a.users.length}명</span></div>
      ${a.users.map((u) => `
        <div class="admin-item">
          <div class="row" style="justify-content:space-between"><b>${esc(u.name)}</b><span class="tiny muted">${esc(u.department ?? '학과 없음')}</span></div>
          <div class="tiny muted">${esc(u.phone ?? '전화번호 없음')} · 가입 ${fmtAt(u.createdAt)} · 마지막 로그인 ${fmtAt(u.lastLogin)}</div>
        </div>`).join('')}
      <p class="tiny muted mt">마지막 로그인은 로그아웃하지 않은 기기 기준이에요.</p>
    </section>
    <section class="card">
      <div class="card-head"><h2>${icon('envelope-simple')}인증메일</h2><span class="hint">가입 못 마친 사람 ${a.emailCodes.notJoined}명</span></div>
      ${a.emailCodes.list.map((c) => `
        <div class="list-item"><span class="small">${esc(c.email)} <span class="tiny muted">${c.purpose === 'reset' ? '비번 찾기' : '가입'}</span></span>
          <span class="tiny">${fmtAt(c.created_at)} · ${c.used ? '사용함' : '<b style="color:var(--red)">안 씀</b>'}${c.attempts ? ` · 틀림 ${c.attempts}` : ''}${c.purpose === 'signup' && !c.joined ? ' · 미가입' : ''}</span></div>`).join('')}
    </section>
    <section class="card">
      <div class="card-head"><h2>${icon('note-pencil')}매칭 신청</h2><span class="hint">대기 ${a.summary.pendingRequests}건 · 전체 ${a.requests.length}건</span></div>
      ${a.requests.map((r) => `
        <div class="admin-item">
          <div class="row" style="justify-content:space-between"><b>${esc(r.name)}</b><span class="pill${r.status === 'pending' ? ' lime' : r.status === 'cancelled' ? ' gray' : ''}">${STATUS[r.status] ?? r.status}</span></div>
          <div class="tiny muted">${esc(scheduleText(r.schedule))} · ${esc(r.location)} · ${styleLabels(r.styles)}</div>
          <div class="tiny muted">신청 ${fmtAt(r.createdAt)}</div>
        </div>`).join('') || '<p class="small muted">신청이 없어요.</p>'}
    </section>
    <section class="card">
      <div class="card-head"><h2>${icon('handshake')}매칭</h2><span class="hint">전체 ${a.matches.length}건</span></div>
      ${a.matches.map((m) => `
        <div class="admin-item">
          <div class="row" style="justify-content:space-between"><b>${esc(m.names.join(' · '))}</b><span class="pill${m.status === 'closed' ? ' gray' : ' lime'}">${STATUS[m.status] ?? m.status}</span></div>
          <div class="tiny muted">${shortDay(m.weekStart)}~${shortDay(m.weekEnd)} · ${esc(scheduleText(m.schedule))} · ${esc(m.location)}</div>
          ${m.leftBy ? `<div class="tiny" style="color:var(--red)">${esc(m.leftBy)}님이 중간에 그만둠</div>` : ''}
        </div>`).join('') || '<p class="small muted">매칭이 없어요.</p>'}
    </section>`;
}
const funnelHTML = (rows) => {
  const max = Math.max(1, ...rows.map((f) => f.count));
  return rows.map((f) => `
        <div class="funnel-row"><span>${f.label}</span><div><i style="width:${(f.count / max) * 100}%"></i></div><b>${f.count}</b></div>`).join('');
};

async function renderAdmin(alive) {
  setTop({ title: '운영자 화면', back: '#/me' });
  setTabs(null);
  loading();
  let data;
  let dash = null;
  try {
    [data, dash] = await Promise.all([api('/admin'), adminTab === 'stats' ? api('/admin/dashboard') : null]);
  } catch (err) {
    if (err.status === 403) {
      view.innerHTML = `<div class="empty"><div class="em">${icon('lock-simple')}</div><h3>운영자만 볼 수 있어요</h3></div>`;
      return;
    }
    throw err;
  }
  if (!alive()) return;
  const when = (iso) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const st = data.stats;
  const KIND = { refund: '환급', reward: '보상' };

  const money = `
    <section class="card">
      <div class="card-head"><h2>${icon('wallet')}입금 확인 대기 <span class="pill">${data.deposits.length}</span></h2></div>
      <p class="tiny muted">통장에 들어온 이름·금액을 보고 확인을 누르면, 그 학생이 바로 매칭 대기열에 들어가요.</p>
      ${data.deposits.map((d) => `
        <div class="admin-row">
          <div><b>${esc(d.depositor || d.name)}</b> · ${won(d.amount)}원
            <div class="tiny muted">${esc(d.name)} · ${esc(d.department ?? '')} · ${esc(d.phone ?? '')} · ${when(d.createdAt)}</div></div>
          <div class="admin-actions">
            <button class="btn primary sm" data-act="deposits/${d.id}/confirm" data-ask="${esc(d.depositor || d.name)}님 ${won(d.amount)}원 입금을 확인했나요?">입금 확인</button>
            <button class="btn ghost sm danger" data-act="deposits/${d.id}/reject" data-ask="입금이 없어 이 신청을 취소할까요?">취소</button>
          </div>
        </div>`).join('') || '<p class="small muted">없어요.</p>'}
    </section>
    <section class="card">
      <div class="card-head"><h2>${icon('bank')}보낼 돈 <span class="pill">${data.payouts.length}</span></h2></div>
      <p class="tiny muted">아래 계좌로 이체한 뒤 '이체 완료'를 눌러 주세요. 학생 마이페이지에도 완료로 보여요.</p>
      ${data.payouts.map((x) => `
        <div class="admin-row">
          <div><b>${esc(x.name)}</b> · ${KIND[x.kind] ?? x.kind} ${won(x.amount)}원
            <div class="small">${x.account ? `${esc(x.bank)} ${esc(x.account)} (${esc(x.holder)})` : '<span class="red">환급 계좌 없음 — 연락 필요</span>'}</div>
            <div class="tiny muted">${esc(x.reason)} · ${esc(x.phone ?? '')} · ${when(x.createdAt)}</div></div>
          <div class="admin-actions"><button class="btn primary sm" data-act="payouts/${x.id}/done" data-ask="${esc(x.name)}님께 ${won(x.amount)}원을 이체했나요?">이체 완료</button></div>
        </div>`).join('') || '<p class="small muted">없어요.</p>'}
    </section>
    <section class="card">
      <div class="card-head"><h2>${icon('receipt')}최근 처리</h2></div>
      ${data.doneMoney.map((x) => `<div class="tiny">${when(x.doneAt ?? '')} · ${esc(x.name)} · ${{ deposit: '입금', refund: '환급', reward: '보상', kept: '귀속' }[x.kind]} ${won(x.amount)}원 · ${x.kind === 'kept' ? '운영진 귀속' : x.status === 'done' ? '완료' : '취소'}</div>`).join('') || '<p class="small muted">없어요.</p>'}
    </section>`;

  const help = `
    <section class="card">
      <div class="card-head"><h2>${icon('envelope-simple')}인증 메일 도움 요청 <span class="pill">${data.help.length}</span></h2></div>
      <p class="tiny muted">전화로 본인인지 확인한 뒤 '인증번호 만들기'를 눌러 나온 번호를 문자로 보내 주세요. (30분 유효, 한 번만 보여요)</p>
      ${data.help.map((h) => `
        <div class="admin-row">
          <div><b>${esc(h.name)}</b> · ${esc(h.phone)}<div class="tiny muted">${esc(h.email)} · ${h.purpose === 'signup' ? '회원가입' : '비밀번호 찾기'} · ${when(h.createdAt)}</div></div>
          <div class="admin-actions">
            <button class="btn primary sm" data-code="${h.id}">인증번호 만들기</button>
            <button class="btn ghost sm" data-act="help/${h.id}/close" data-ask="이 요청을 닫을까요? (가입이 끝난 경우)">닫기</button>
          </div>
        </div>`).join('') || '<p class="small muted">없어요.</p>'}
    </section>
    <section class="card">
      <div class="card-head"><h2>${icon('paper-plane-tilt')}메일 발송 기록</h2><span class="hint">최근 7일 성공 ${st.mailSent7d} · 실패 ${st.mailFailed7d}</span></div>
      ${data.emailLogs.map((l) => `
        <div class="tiny admin-log ${l.status}">${when(l.createdAt)} · ${esc(l.email)} · ${l.status === 'sent' ? '보냄' : '<b>실패</b>'} · ${l.attempts}번 시도${l.provider ? ` · ${esc(l.provider)}` : ''}${l.error ? `<div class="muted">${esc(l.error)}</div>` : ''}</div>`).join('') || '<p class="small muted">아직 기록이 없어요.</p>'}
    </section>`;

  const chats = `
    <section class="card">
      <div class="card-head"><h2>${icon('chat-circle')}매칭별 채팅 기록</h2></div>
      <p class="tiny muted">신고·분쟁 확인용이에요. 열어 본 기록이 남아요.</p>
      ${data.matches.map((m) => `
        <button type="button" class="list-item link-item admin-match" data-chat="${m.id}">
          <div><b>${esc(m.nameA)} · ${esc(m.nameB)}</b>${m.botA || m.botB ? ' <span class="pill gray">데모</span>' : ''}
            <div class="tiny muted">${fmtDate(m.weekStart)} ~ ${fmtDate(m.weekEnd)} · ${esc(m.location)} · ${{ active: '진행 중', reported: '리포트', closed: '종료' }[m.status] ?? m.status}</div></div>
          <span class="pill">${m.messageCount}개</span>
        </button>`).join('') || '<p class="small muted">매칭이 아직 없어요.</p>'}
    </section>
    <div id="admin-chat"></div>`;

  view.innerHTML = `
    <div class="admin-stats">
      <div><b>${st.users}</b><span>가입자</span></div>
      <div><b>${st.activeMatches}</b><span>진행 중 매칭</span></div>
      <div><b>${st.waiting}</b><span>매칭 대기</span></div>
      <div><b>${data.deposits.length + data.payouts.length}</b><span>돈 처리</span></div>
    </div>
    <div class="mate-tabs admin-tabs">${ADMIN_TABS.map(([k, label]) => `<a href="#/admin" data-tab="${k}" class="${k === adminTab ? 'on' : ''}">${label}</a>`).join('')}</div>
    <div id="admin-body">${adminTab === 'stats' ? adminStatsHTML(dash) : { money, help, chats }[adminTab]}</div>`;

  // 전환 단계: 전체 ↔ 오늘만
  $('#funnel-today')?.addEventListener('click', (e) => {
    const today = e.target.getAttribute('aria-pressed') !== 'true';
    e.target.setAttribute('aria-pressed', today);
    e.target.textContent = today ? '전체 보기' : '오늘만 보기';
    $('#funnel').innerHTML = funnelHTML(today ? dash.funnel.today : dash.funnel.all);
  });

  $('.admin-tabs').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-tab]');
    if (!a) return;
    e.preventDefault();
    adminTab = a.dataset.tab;
    router();
  });

  const onClick = async (e) => {
    const act = e.target.closest('[data-act]');
    if (act) {
      if (!confirm(act.dataset.ask)) return;
      act.disabled = true;
      try {
        const res = await api(`/admin/${act.dataset.act}`, { method: 'POST' });
        toast(res.matchId ? '입금 확인 · 바로 매칭됐어요.' : res.matchError ? `입금 확인 · 매칭은 안 됐어요 (${res.matchError})` : res.refunded ? '학생이 신청을 취소해서 환급 목록에 넣었어요.' : act.dataset.act.endsWith('/confirm') ? '입금을 확인했어요. 메이트를 찾는 중이에요.' : '처리했어요.');
        router();
      } catch (err) { toast(err.message, true); act.disabled = false; }
      return;
    }
    const codeBtn = e.target.closest('[data-code]');
    if (codeBtn) {
      if (!confirm('본인 확인을 마쳤나요? 새 인증번호를 만들어요.')) return;
      try {
        const r = await api(`/admin/help/${codeBtn.dataset.code}/code`, { method: 'POST' });
        const modal = $('#modal');
        modal.innerHTML = `
          <div class="sheet center">
            <h3>인증번호</h3>
            <div class="code big-code">${esc(r.code)}</div>
            <p class="small">${esc(r.name)} · ${esc(r.phone)}<br><span class="tiny muted">${esc(r.email)} · ${r.expiresMin}분 동안 유효 · 이 창을 닫으면 다시 볼 수 없어요</span></p>
            <button class="btn primary block mt" id="code-ok">문자로 보냈어요</button>
          </div>`;
        modal.hidden = false;
        $('#code-ok').addEventListener('click', () => { closeModal(); router(); });
      } catch (err) { toast(err.message, true); }
      return;
    }
    const chatBtn = e.target.closest('[data-chat]');
    if (chatBtn) {
      try {
        const c = await api(`/admin/matches/${chatBtn.dataset.chat}/chat`);
        const ids = Object.keys(c.users).map(Number);
        const box = $('#admin-chat');
        box.innerHTML = `
          <section class="card">
            <div class="card-head"><h2>${icon('chat-circle')}${ids.map((id) => esc(c.users[id].name)).join(' · ')}</h2><span class="hint">${c.messages.length}개</span></div>
            <p class="tiny muted">${ids.map((id) => `${esc(c.users[id].name)}: ${esc(c.users[id].email)} · ${esc(c.users[id].phone ?? '')}`).join('<br>')}</p>
            <div class="chat admin-chat">${c.messages.map((msg) => bubbleHTML(msg, msg.userId === ids[0] ? 'mate' : 'me', c.users[msg.userId]?.name)).join('') || '<p class="small muted center">대화가 없어요.</p>'}</div>
          </section>`;
        box.querySelector('.admin-chat').addEventListener('click', (ev) => {
          const img = ev.target.closest('img.chat-photo');
          if (img) zoomPhoto(img.src);
        });
        box.scrollIntoView({ behavior: 'smooth' });
      } catch (err) { toast(err.message, true); }
    }
  };
  view.addEventListener('click', onClick);
  onLeave(() => view.removeEventListener('click', onClick));
}

// ───────────────────────── 마이페이지 ─────────────────────────

async function renderMe(alive) {
  setTop({ title: '마이페이지' });
  setTabs('me');
  loading();
  const [{ user }, { matches }, { money }] = await Promise.all([
    api('/me'), api('/me/history'), api('/me/money').catch(() => ({ money: [] })),
  ]);
  if (!alive()) return;

  const MONEY_KIND = { deposit: '보증금 입금', refund: '돌려받을 돈', reward: '보상', kept: '운영진 귀속' };
  const MONEY_STATUS = {
    deposit: { todo: ['입금 확인 전', 'gray'], done: ['입금 확인됨', ''] },
    refund: { todo: ['이체 예정', 'gray'], done: ['이체 완료', ''] },
    reward: { todo: ['이체 예정', 'gray'], done: ['이체 완료', ''] },
    kept: { done: ['돌려받지 않음', 'red'] },
  };

  view.innerHTML = `
    ${user.isAdmin ? '<a class="btn block admin-link" href="#/admin">운영자 화면</a>' : ''}
    <section class="card">
      <div class="card-head"><h2>${icon('user')}내 프로필</h2><a class="link" href="#/me/edit">수정하기${icon('caret-right')}</a></div>
      <div class="profile">
        ${avatarHTML(user, 'lg')}
        <div>
          <div class="name">${esc(user.name)}</div>
          <div class="small muted">${esc(user.email)}</div>
          ${user.department || user.phone ? `<div class="small muted">${esc([user.department, user.phone].filter(Boolean).join(' · '))}</div>` : ''}
          ${user.bio ? `<div class="small mt">${esc(user.bio)}</div>` : ''}
          <div class="tags">${user.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>${icon('books')}지난 스터디</h2></div>
      ${matches.length ? matches.map((h) => `
        <a class="list-item link-item" href="#/history/${h.id}">
          <div class="row">
            ${avatarHTML(h.mate, 'sm')}
            <div><div><b>${esc(h.mate.name)}</b></div><div class="tiny muted">${fmtDate(h.weekStart)} ~ ${fmtDate(h.weekEnd)} · ${esc(h.location)}</div></div>
          </div>
          <span class="row" style="gap:6px">${h.left ? `<span class="pill red">${h.left === 'me' ? '내가 그만둠' : '메이트가 그만둠'}</span>` : h.report ? `<span class="pill">${h.report.me.rate}% · ${fmtMinutes(h.report.me.minutes)}</span>` : ''}<span class="chev">${icon('caret-right')}</span></span>
        </a>`).join('') : '<p class="small muted">첫 주를 마치면 여기에 기록이 쌓여요.</p>'}
    </section>

    ${money.length || user.refund ? `
    <section class="card">
      <div class="card-head"><h2>${icon('wallet')}보증금 내역</h2></div>
      ${user.refund ? `<p class="tiny muted">돌려받을 계좌: ${esc(user.refund.bank)} ${esc(user.refund.account)} (${esc(user.refund.holder)})</p>` : ''}
      ${money.map((x) => {
        const [label, cls] = MONEY_STATUS[x.kind]?.[x.status] ?? [x.status, 'gray'];
        return `
        <div class="list-item">
          <div><b>${MONEY_KIND[x.kind] ?? x.kind} ${won(x.amount)}원</b><div class="tiny muted">${esc(x.reason)} · ${fmtDate(x.createdAt.slice(0, 10))}</div></div>
          <span class="pill ${cls}">${label}</span>
        </div>`;
      }).join('') || '<p class="small muted">아직 내역이 없어요.</p>'}
    </section>` : ''}

    <p class="tiny muted center mt">안전한 운영을 위해 신고·분쟁이 있을 때 운영진이 채팅 기록을 확인할 수 있어요.</p>
    <button class="btn ghost block mt-lg danger" id="logout">로그아웃</button>
    ${window.__mockReset ? '<button class="btn ghost block small muted" id="reset">이 브라우저의 데모 데이터 모두 지우기</button>' : ''}`;

  $('#reset')?.addEventListener('click', () => {
    if (!confirm('이 브라우저에 저장된 계정·매칭 기록을 모두 지우고 처음 상태로 돌아갈까요?')) return;
    window.__mockReset();
    location.hash = '#/login';
    location.reload();
  });

  $('#logout').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    location.hash = '#/login';
  });
}

async function renderEditProfile(alive) {
  setTop({ title: '프로필 수정', back: '#/me' });
  setTabs(null);
  loading();
  const { user } = await api('/me');
  if (!alive()) return;
  let avatar = user.avatar;
  const avatars = AVATARS.includes(avatar) ? AVATARS : [avatar, ...AVATARS.slice(0, -1)];

  view.innerHTML = `
    ${OPTIONS.photos ? `
    <section class="card">
      <div class="card-head"><h2>${icon('camera')}프로필 사진</h2></div>
      <div class="row" style="gap:14px">
        <div id="photo-preview">${avatarHTML(user, 'lg')}</div>
        <div class="stack" style="flex:1">
          <label class="btn block">사진 올리기<input type="file" id="profile-photo" accept="image/*" hidden></label>
          <button type="button" class="btn ghost block danger sm" id="photo-remove"${user.photo ? '' : ' hidden'}>사진 지우기</button>
        </div>
      </div>
      <p class="tiny muted mt">사진은 나와 매칭된 메이트에게만 보여요. 사진이 없으면 아래 아바타가 보여요.</p>
    </section>` : ''}
    <form id="f" class="card">
      <div class="field"><span>아바타</span>
        <div class="avatar-picker" id="avatars">
          ${avatars.map((a) => `<button type="button" aria-pressed="${a === avatar}">${a}</button>`).join('')}
        </div>
      </div>
      <label class="field"><span>이름 (닉네임)</span><input class="input" name="name" maxlength="20" value="${esc(user.name)}" required></label>
      <label class="field"><span>학과</span><input class="input" name="department" maxlength="30" value="${esc(user.department ?? '')}" placeholder="예: 경영정보학부" required></label>
      <label class="field"><span>전화번호 (메이트에게는 보이지 않아요)</span><input class="input" name="phone" type="tel" inputmode="numeric" value="${esc(user.phone ?? '')}" placeholder="010-1234-5678" required></label>
      <label class="field"><span>태그 (쉼표로 구분, 최대 5개)</span><input class="input" name="tags" value="${esc(user.tags.join(', '))}" placeholder="#카페공부, #자격증준비, #ENFJ"></label>
      <label class="field"><span>한 줄 소개</span><textarea class="input" name="bio" maxlength="200" placeholder="메이트에게 나를 소개해 주세요">${esc(user.bio)}</textarea></label>
      <button class="btn primary block mt-lg">저장하기</button>
    </form>`;

  const showPhoto = (u) => {
    $('#photo-preview').innerHTML = avatarHTML(u, 'lg');
    $('#photo-remove').hidden = !u.photo;
  };
  $('#profile-photo')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const photo = await compressImage(file, 800, 0.85);
      const { user: u } = await withLoading('사진을 올리는 중이에요', () => api('/me/photo', { method: 'PUT', body: { photo } }), 300);
      showPhoto(u);
      toast('프로필 사진을 바꿨어요.');
    } catch (err) { toast(err.message, true); }
  });
  $('#photo-remove')?.addEventListener('click', async () => {
    try {
      const { user: u } = await api('/me/photo', { method: 'DELETE' });
      showPhoto(u);
      toast('프로필 사진을 지웠어요.');
    } catch (err) { toast(err.message, true); }
  });

  $('#avatars').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    avatar = b.textContent;
    $$('#avatars button').forEach((x) => x.setAttribute('aria-pressed', x === b));
  });
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      await withLoading('프로필을 저장하는 중이에요', () => api('/me', {
        method: 'PUT',
        body: { ...fd, avatar, tags: fd.tags.split(/[,\s]+/).filter(Boolean) },
      }));
      toast('프로필을 저장했어요.');
      history.back();
    } catch (err) { toast(err.message, true); }
  });
}
