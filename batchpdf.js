const path = require('path');
const fs = require('fs');
const { crawlNaverBlogSearchAllPages, searchBlogs } = require('./crawler');
const { saveBlogPostAsPDF } = require('./makepdf');
const { stringify } = require('querystring');
const puppeteer = require('puppeteer');

/**
 * 파일명으로 사용할 수 있도록 URL을 안전하게 변환
 */
function urlToFilename(url) {
     return (
          url
               .replace(/https?:\/\//, '')
               .replace(/[^a-zA-Z0-9-_\.]/g, '_')
               .slice(0, 100) + '.pdf'
     ); // 너무 길면 100자 제한
}

async function main() {
     const [, , companyname, startDate, endDate] = process.argv;
     require('dotenv').config();
     const apiKey = process.env.GEMINI_API_KEY;
     if (!companyname || !startDate || !endDate) {
          console.error(
               '사용법: node batchpdf.js <keyword> <startDate> <endDate> [geminiApiKey]'
          );
          process.exit(1);
     }
     console.log(
          `[INFO] 블로그 크롤링 시작: ${companyname}, ${startDate} ~ ${endDate}`
     );
     let browser;
     browser = await puppeteer.launch({ headless: true });
     try {
          // 크롤링
          const resultFile = await searchBlogs(companyname, startDate, endDate);
          // const posts = await crawlNaverBlogSearchAllPages(
          //      companyname,
          //      startDate,
          //      endDate,
          //      browser
          // );
          if (!resultFile || resultFile.length === 0) {
               console.log('[INFO] 검색 결과가 없습니다.');
               return;
          }
          if (resultFile.length > 100) {
               console.warn(
                    '[WARNING] 검색 결과가 100건을 초과합니다. 키워드를 더 구체적으로 설정하거나, 날짜범위를 제한하세요.'
               );
               return;
          }

          await processBlogResults(
               companyname,
               resultFile,
               apiKey,
               undefined,
               undefined,
               undefined
          );
     } finally {
          await browser.close();
     }
     console.log('[SUCCESS] 모든 PDF 생성 완료!');
}

async function processBlogResults(
     companyname,
     resultsFile,
     apiKey = '',
     filteringCondition,
     pdfGenerationCondition = '',
     progressCallback // <-- 추가: 진행률 콜백
) {
     try {
          // resultsFile이 디렉토리인지 확인
          if (
               fs.existsSync(resultsFile) &&
               fs.lstatSync(resultsFile).isDirectory()
          ) {
               console.error(
                    `[ERROR] ${resultsFile} 경로는 디렉토리입니다. 올바른 JSON 파일 경로를 전달하세요.`
               );
               return;
          }
          // console.log(resultsFile);
          // JSON 파일 읽기
          // const rawData = fs.readFileSync(resultsFile);
          // 필터링 조건이 없으면 디폴트 사용

          const blogs = await filterJsonWithGemini(
               resultsFile,
               apiKey,
               filteringCondition
          );

          if (blogs.length > 100) {
               console.warn(
                    '[WARNING] 검색 결과가 100건을 초과합니다. 키워드를 더 구체적으로 설정하거나, 날짜범위를 제한하세요.'
               );
               return;
          }

          console.log(`[INFO] ${blogs.length}개의 블로그 포스트를 처리합니다.`);

          // 각 블로그 포스트에 대해 PDF 생성
          let current = 0;
          const total = blogs.length;
          for (const blog of blogs) {
               const outputPath = urlToFilename(blog.url);
               try {
                    await saveBlogPostAsPDF(
                         companyname,
                         blog.url,
                         outputPath,
                         pdfGenerationCondition,
                         apiKey
                    );
               } catch (error) {
                    console.error(
                         `[ERROR] PDF 생성 실패 (${blog.url}):`,
                         error.message
                    );
               }
               current++;
               if (progressCallback) progressCallback(current, total);
               // 과도한 요청 방지를 위한 딜레이
               await new Promise((resolve) => setTimeout(resolve, 1000));
          }

          console.log('[INFO] 모든 PDF 생성이 완료되었습니다.');
     } catch (error) {
          console.error('[ERROR] JSON 파일 처리 중 오류:', error);
          throw error;
     }
}

/**
 * Gemini API를 호출해 본문 텍스트로부터 PDF 생성 여부를 판단
 * @param {string} text - 블로그 본문 텍스트
 * @returns {Promise<boolean>} - true면 PDF 생성, false면 생성하지 않음
 */
async function filterJsonWithGemini(
     rawData,
     apiKey = '',
     filteringCondition = `
          0. 기업의 정성적인 분석 내용 위주인 경우만 포함
          1. 기업의 실적분석이나, 실적 추정 내용이 있는 경우 반드시 포함
          2. 사업부문 분석, 비지니스모델 분석, 재무분석, 밸류에이션, 산업분석, 경제적 해자 분석, 경쟁력 분석, 경쟁우위, 경쟁사 분석 중 어느 하나라도 포함되어 있으면 반드시 포함
          2. 애널리스트의 리포트 내용을 요약한 경우는 제외(예를 들어, xxx 애널리스트의 리포트 요약 등은 제외할 것)
          3. 주가의 급등락, 거래량, 거래대금 등의 정량적인 내용에 집중한 경우는 제외
          4. 기업의 제품에 대한 리뷰 포스팅은 제외`
) {
     apiKey = apiKey || 'YOUR_GEMINI_API_KEY';
     const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;
     const prompt = `
     아래의 블로그 리스트를 읽고, 판단조건을 만족할 가능성이 낮은 포스트는 제외하고, 반드시 JSON만 반환하세요. 불필요한 설명, 코드블록, 주석, 텍스트는 제거하세요.
     판단조건 :
     ${filteringCondition}
     
     분석 대상 리스트 : 
     ${JSON.stringify(rawData)}
     `;

     const body = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
               responseMimeType: 'application/json',
          },
     };

     try {
          const response = await fetch(url, {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify(body),
          });

          const result = await response.json();
          const answer =
               result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          const resultJson = JSON.parse(answer);

          console.log(
               `[INFO] 리스트 1차 필터링 결과 총 ${rawData.length} 건 중 ${resultJson.length} 건이 관련 블로그로 필터링 되었습니다.`
          );
          return resultJson;
     } catch (e) {
          console.error('[ERROR] Gemini API 호출 실패:', e);
          // API 실패 시 기본적으로 PDF 생성
          return true;
     }
}

if (require.main === module) {
     main();
}

module.exports = {
     processBlogResults,
};
