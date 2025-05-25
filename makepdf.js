const puppeteer = require('puppeteer');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

/**
 * 주어진 네이버 블로그 포스팅 URL을 PDF로 저장하는 함수
 * @param {string} companyname - 회사명
 * @param {string} blogUrl - PDF로 저장할 네이버 블로그 포스트의 URL
 * @param {string} outputPath - 저장할 PDF 파일 경로 (예: 'output.pdf')
 */
async function saveBlogPostAsPDF(
     companyname,
     blogUrl,
     outputPath,
     pdfGenerationCondition = '',
     apiKey = ''
) {
     let browser, page;
     try {
          // companyname 하위 폴더 생성 및 경로 지정
          const companyDir = path.join(process.cwd(), companyname);
          if (!fs.existsSync(companyDir)) {
               fs.mkdirSync(companyDir, { recursive: true });
          }
          const pdfFileName = path.basename(outputPath);
          outputPath = path.join(companyDir, pdfFileName);

          browser = await puppeteer.launch({ headless: true });
          page = await browser.newPage();

          // 뷰포트 크기 설정
          await page.setViewport({
               width: 1200,
               height: 800,
          });

          await page.goto(blogUrl, {
               waitUntil: 'networkidle0',
               timeout: 60000,
          });

          // iframe 찾기 및 메인 프레임 설정
          let mainFrame = page;
          const frames = page.frames();
          for (const frame of frames) {
               if (
                    frame.url().includes('blog.naver.com') &&
                    frame !== page.mainFrame()
               ) {
                    mainFrame = frame;
                    break;
               }
          }

          // 본문 텍스트 추출 (초기 판단용)
          const blogTextQuick = await mainFrame.evaluate(() => {
               const el = document.querySelector(
                    '#post-view\\[\\d+\\], .se-main-container'
               );
               return el ? el.innerText : document.body.innerText;
          });
          console.log(`[INFO] ${blogUrl} 분석중..`);
          const shouldGeneratePDFResult = await shouldGeneratePDFWithGemini(
               companyname,
               blogTextQuick,
               pdfGenerationCondition,
               apiKey
          );
          const shouldGenerate = shouldGeneratePDFResult.result === 'YES';
          const reason = shouldGeneratePDFResult.reason;

          if (!shouldGenerate) {
               console.log('[INFO] Gemini 판단 결과: PDF 생성하지 않음.');
               console.log(`[REASON] ${reason} \n`);
               return;
          }

          console.log('[INFO] Gemini 판단 결과: PDF 생성준비중.');
          console.log(`[REASON] ${reason}`);

          // 컨텐츠 높이 계산 (더 정확한 방법으로)
          const contentHeight = await mainFrame.evaluate(() => {
               // 모든 가능한 컨테이너 선택자 시도
               const selectors = [
                    '#post-view\\[\\d+\\]',
                    '.se-main-container',
                    '.blog2_container',
                    '.post-content',
                    '#content',
                    '.se_component_wrap',
               ];

               let maxHeight = 0;
               for (const selector of selectors) {
                    const elements = document.querySelectorAll(selector);
                    elements.forEach((el) => {
                         const height = el.getBoundingClientRect().height;
                         if (height > maxHeight) maxHeight = height;
                    });
               }

               // 최소한 body 높이는 확보
               return Math.max(maxHeight, document.body.scrollHeight);
          });

          // 뷰포트 높이 조정 (여유있게)
          await page.setViewport({
               width: 1200,
               height: contentHeight + 600, // 여유 공간 더 넉넉하게
          });

          // 전체 페이지 스크롤
          await autoScroll(mainFrame);

          // URL과 reason 정보 추가 (스타일 개선)
          await mainFrame.evaluate(
               (url, reason) => {
                    const infoDiv = document.createElement('div');
                    infoDiv.style.width = '100%';
                    infoDiv.style.background = '#f8f9fa';
                    infoDiv.style.borderBottom = '2px solid #e9ecef';
                    infoDiv.style.padding = '20px';
                    infoDiv.style.marginBottom = '30px';
                    infoDiv.style.boxSizing = 'border-box';
                    infoDiv.style.position = 'relative';
                    infoDiv.style.zIndex = '1000';
                    infoDiv.style.fontFamily =
                         '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

                    const urlDiv = document.createElement('div');
                    urlDiv.style.fontSize = '16px';
                    urlDiv.style.marginBottom = '12px';
                    urlDiv.style.color = '#495057';
                    urlDiv.style.fontWeight = '600';
                    urlDiv.innerHTML = `<span style="color:#868e96;width:70px;display:inline-block;">URL:</span> <a href="${url}" style="color:#228be6;text-decoration:none;word-break:break-all;font-weight:500;">${url}</a>`;

                    const reasonDiv = document.createElement('div');
                    reasonDiv.style.fontSize = '15px';
                    reasonDiv.style.lineHeight = '1.6';
                    reasonDiv.style.color = '#495057';
                    reasonDiv.style.whiteSpace = 'pre-wrap';
                    reasonDiv.innerHTML = `<span style="color:#868e96;width:70px;display:inline-block;">생성 사유:</span> <span style="font-weight:500;">${reason}</span>`;

                    infoDiv.appendChild(urlDiv);
                    infoDiv.appendChild(reasonDiv);

                    // body의 가장 앞에 추가
                    if (document.body.firstChild) {
                         document.body.insertBefore(
                              infoDiv,
                              document.body.firstChild
                         );
                    } else {
                         document.body.appendChild(infoDiv);
                    }
               },
               blogUrl,
               reason
          );

          // 페이지가 완전히 로드될 때까지 대기
          await new Promise((resolve) => setTimeout(resolve, 2000));

          // PDF 저장
          await page.pdf({
               path: outputPath,
               width: '1200px',
               height: `${contentHeight + 400}px`, // 여유 공간 포함
               printBackground: true,
               margin: {
                    top: '40px',
                    right: '20px',
                    bottom: '20px',
                    left: '20px',
               },
          });

          console.log(`[INFO] PDF가 성공적으로 저장되었습니다: ${outputPath}`);

          if (browser) await browser.close();
          return { url: blogUrl, reason: reason };
     } catch (err) {
          console.error(`[ERROR] PDF 저장 실패:`, err.message);
          if (browser) await browser.close();
          return;
     }
}

/**
 * 주어진 네이버 블로그 포스팅 URL을 저장하는 함수
 * @param {string} companyname - 회사명
 * @param {string} blogUrl - 저장할 네이버 블로그 포스트의 URL
 * @param {string} outputPath - 저장할  파일 경로 (예: 'output.pdf')
 */
async function saveBlogPostAsJSON(
     companyname,
     blogUrl,
     outputPath,
     pdfGenerationCondition = '',
     apiKey = ''
) {
     let browser, page;
     try {
          // companyname 하위 폴더 생성 및 경로 지정
          const companyDir = path.join(process.cwd(), companyname);
          if (!fs.existsSync(companyDir)) {
               fs.mkdirSync(companyDir, { recursive: true });
          }
          // const pdfFileName = path.basename(outputPath);
          // outputPath = path.join(companyDir, pdfFileName);

          browser = await puppeteer.launch({ headless: true });
          page = await browser.newPage();

          // 뷰포트 크기 설정
          await page.setViewport({
               width: 1200,
               height: 800,
          });

          await page.goto(blogUrl, {
               waitUntil: 'networkidle0',
               timeout: 60000,
          });

          // iframe 찾기 및 메인 프레임 설정
          let mainFrame = page;
          const frames = page.frames();
          for (const frame of frames) {
               if (
                    frame.url().includes('blog.naver.com') &&
                    frame !== page.mainFrame()
               ) {
                    mainFrame = frame;
                    break;
               }
          }

          // 본문 텍스트 추출 (초기 판단용)
          const blogTextQuick = await mainFrame.evaluate(() => {
               const el = document.querySelector(
                    '#post-view\\[\\d+\\], .se-main-container'
               );
               return el ? el.innerText : document.body.innerText;
          });
          console.log(`[INFO] ${blogUrl} 분석중..`);
          const shouldGeneratePDFResult = await shouldGeneratePDFWithGemini(
               companyname,
               blogTextQuick,
               pdfGenerationCondition,
               apiKey
          );
          const shouldGenerate = shouldGeneratePDFResult.result === 'YES';
          const reason = shouldGeneratePDFResult.reason;

          if (!shouldGenerate) {
               console.log('[INFO] Gemini 판단 결과: url 저장하지 않음.');
               console.log(`[REASON] ${reason} \n`);
               return;
          }

          console.log('[INFO] Gemini 판단 결과: url 저장.');
          console.log(`[REASON] ${reason}`);

          if (browser) await browser.close();
          return { url: blogUrl, reason: reason };
     } catch (err) {
          console.error(`[ERROR] url 저장 실패:`, err.message);
          if (browser) await browser.close();
          return;
     }
}

/**
 * Gemini API를 호출해 본문 텍스트로부터 PDF 생성 여부를 판단
 * @param {string} companyname
 * @param {string} text - 블로그 본문 텍스트
 * @param {string} pdfGenerationCondition - 사용자 입력 조건(없으면 디폴트)
 * @returns {Promise<boolean>} - true면 PDF 생성, false면 생성하지 않음
 */
async function shouldGeneratePDFWithGemini(
     companyname,
     text,
     pdfGenerationCondition = '',
     apiKey = ''
) {
     if (!pdfGenerationCondition) {
          pdfGenerationCondition = `
          1. ${companyname}에 대한 분석을 위주로 분석한 경우(예를 들면, ${companyname}의 실적분석, 밸류에이션, 산업분석 등).
          2. 분석 내용이 ${companyname}이 아닌 타기업에 대한 분석의 비중이 큰 경우에는 제외.
          3. 가치투자의 측면에서 정성적으로 분석한 경우
          4. 분석 내용이 유용하고, 정보가 풍부한 경우, 내용이 직접 작성한 경우
          5. 단순히 타인의 블로그 분석한 내용을 인용한 것에 불과한경우는 제외
          6. 증권서 애널리스트의 리포트 내용을 단순 요약한 경우는 제외(예를 들어, xxx 애널리스트의 리포트 요약 등은 제외할 것)
          7. 단순히 주가나 거래량 등의 정량적인 내용에 집중한 경우는 제외
          8. 시황에 관한 분석은 반드시 제외할 것
          9. 특징주, 이슈주, 테마주, 급등주 등에 대한 포스팅은 반드시 제외할 것`;
     }
     const prompt = `
     아래 블로그 본문을 읽고 PDF로 저장할 가치가 있는지를 판단하여, 저장가치가 있으면 'YES', 그렇지 않으면 'NO'만 대답하세요. 반드시 그렇게 판단한 이유도 함께 작성하세요.\n
     \n
     답변 형식을 다음과 같습니다.\n
     답변형식:
     {"result": "YES" || "NO" , "reason": 판단근거 }
     \n
     다음의 판단조건을 모두 만족해야 합니다.     
     판단조건 :     
     ${pdfGenerationCondition}
     \n
     분석 대상 블로그 본문 : ${text}`;
     const body = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
               responseMimeType: 'application/json',
          },
     };

     try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;
          // const fetch = (await import('node-fetch')).default;
          const response = await fetch(url, {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify(body),
          });
          const result = await response.json();
          const answer =
               result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          const resultJson = JSON.parse(answer);
          return resultJson;
          // return resultJson.result === 'YES';
     } catch (e) {
          console.error('[ERROR] Gemini API 호출 실패:', e.message);
          // API 실패 시 기본적으로 PDF 생성
          return true;
     }
}

// 전체 페이지 스크롤 다운 함수
async function autoScroll(frame) {
     await frame.evaluate(async () => {
          await new Promise((resolve) => {
               let totalHeight = 0;
               const distance = 300;
               const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;

                    if (totalHeight >= scrollHeight) {
                         clearInterval(timer);
                         // 모든 이미지가 로드될 때까지 대기
                         const images = document.getElementsByTagName('img');
                         Promise.all(
                              Array.from(images).map((img) => {
                                   if (img.complete) return;
                                   return new Promise((resolve) =>
                                        img.addEventListener('load', resolve)
                                   );
                              })
                         ).then(() => {
                              setTimeout(resolve, 1000); // 추가 대기 시간
                         });
                    }
               }, 100);
          });
     });
}

// 예시 실행 (직접 실행 시)
if (require.main === module) {
     const url = process.argv[2];

     const output = process.argv[3] || 'output.pdf';
     if (!url) {
          console.error('사용법: node makepdf.js <blogUrl> [outputPath]');
          process.exit(1);
     }
     saveBlogPostAsPDF('', url, output);
}

module.exports = { saveBlogPostAsPDF, saveBlogPostAsJSON };
