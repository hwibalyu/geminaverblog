const puppeteer = require('puppeteer');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function crawlNaverBlogSearchAllPages(
     keyword,
     startDate,
     endDate,
     browser
) {
     let page;
     const allResults = [];

     try {
          console.log(
               `[INFO] 키워드 "${keyword}"로 네이버 블로그 전체 페이지 검색을 시작합니다.`
          );
          page = await browser.newPage();
          await page.setViewport({ width: 1366, height: 768 });

          const blogHomeUrl = 'https://section.blog.naver.com/';
          await page.goto(blogHomeUrl, { waitUntil: 'networkidle2' });

          const searchInputSelector = 'input[name="sectionBlogQuery"]';
          await page.waitForSelector(searchInputSelector, { visible: true });
          await page.type(searchInputSelector, keyword);

          const searchButtonSelector = '.area_search .button_blog';
          await page.waitForSelector(searchButtonSelector, { visible: true });

          await Promise.all([
               page.waitForNavigation({
                    waitUntil: 'networkidle2',
                    timeout: 60000,
               }),
               page.click(searchButtonSelector),
          ]);
          // console.log(`[INFO] 초기 검색 완료. URL: ${page.url()}`);

          // console.log('[INFO] 기간 필터를 입력값으로 변경합니다.');
          const periodDropdownSelector =
               '.search_option .area_dropdown[data-set="period"] > a.present_selected';
          await page.waitForSelector(periodDropdownSelector, {
               visible: true,
               timeout: 10000,
          });
          await page.click(periodDropdownSelector);

          await delay(500);

          // '기간 입력' 버튼 클릭
          const customPeriodSelector =
               '.search_option .area_dropdown[data-set="period"] .dropdown_select a.item';
          const customPeriodButtons = await page.$$(customPeriodSelector);
          let customInputButton = null;
          for (const btn of customPeriodButtons) {
               const text = await btn.evaluate((el) => el.textContent.trim());
               if (text === '기간 입력') {
                    customInputButton = btn;
                    break;
               }
          }
          if (!customInputButton)
               throw new Error('기간 입력 버튼을 찾을 수 없습니다.');
          await customInputButton.click();
          await delay(300);

          // 날짜 입력
          await page.waitForSelector('#search_start_date', {
               visible: true,
               timeout: 5000,
          });
          await page.waitForSelector('#search_end_date', {
               visible: true,
               timeout: 5000,
          });
          // input에 값 입력 (value 속성 직접 변경)
          await page.evaluate(
               (start, end) => {
                    const startInput =
                         document.querySelector('#search_start_date');
                    const endInput = document.querySelector('#search_end_date');
                    if (startInput) {
                         startInput.value = start;
                         startInput.dispatchEvent(
                              new Event('input', { bubbles: true })
                         );
                    }
                    if (endInput) {
                         endInput.value = end;
                         endInput.dispatchEvent(
                              new Event('input', { bubbles: true })
                         );
                    }
               },
               startDate,
               endDate
          );

          // 적용 버튼 클릭
          await page.waitForSelector('#periodSearch', { visible: true });
          await Promise.all([
               page.waitForNavigation({
                    waitUntil: 'networkidle2',
                    timeout: 60000,
               }),
               page.click('#periodSearch'),
          ]);
          console.log(
               `[SUCCESS] 기간을 ${startDate} ~ ${endDate}로 변경 완료. URL: ${page.url()}`
          );

          // 검색결과 건수 추출 및 출력
          try {
               const infoSelector = '.search_information .search_number';
               await page.waitForSelector(infoSelector, { timeout: 5000 });
               const resultCount = await page.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    if (!el) return null;
                    // 숫자만 추출
                    const match = el.textContent.replace(/,/g, '').match(/\d+/);
                    return match ? parseInt(match[0], 10) : null;
               }, infoSelector);
               if (resultCount !== null) {
                    console.log(`[INFO] 검색결과 건수: ${resultCount}건`);
               }
          } catch (e) {
               console.log('[INFO] 검색결과 건수 추출 실패:', e.message);
          }

          let crawlingPageNum = 1; // 크롤링 중인 실제 페이지 번호 (화면에 표시되는 번호)
          let logicalPageNumForNextButton = 1; // 다음 페이지 버튼을 찾기 위한 논리적 페이지 번호

          while (true) {
               console.log(
                    `[INFO] 현재 ${crawlingPageNum} 페이지 데이터 추출 중...\r`
               );

               const postListSelector = '.area_list_search .list_search_post';
               try {
                    await page.waitForSelector(postListSelector, {
                         timeout: 15000,
                    });
               } catch (e) {
                    console.log(
                         `[INFO] ${crawlingPageNum} 페이지에서 게시물 목록(${postListSelector})을 찾을 수 없습니다.`
                    );
                    const emptyResultCheck = await page.$('.nodata');
                    if (emptyResultCheck) {
                         console.log(
                              `[INFO] ${crawlingPageNum} 페이지에 검색 결과가 없습니다 (nodata 확인).`
                         );
                    }
                    break;
               }

               const pageResults = await page.evaluate((selector) => {
                    const items = Array.from(
                         document.querySelectorAll(selector)
                    );
                    return items.map((item) => {
                         const titleAnchor =
                              item.querySelector('.title_post .title');
                         const linkAnchor = item.querySelector('a.desc_inner');
                         const descriptionEl = item.querySelector('.text');
                         // 날짜 추출
                         let dateText = null;
                         const dateEl = item.querySelector('.date');
                         if (dateEl) {
                              dateText = dateEl.innerText.trim();
                         } else {
                              // 날짜 클래스가 다를 경우, 다른 위치에서 추출 시도
                              const altDateEl =
                                   item.querySelector('.sub_info .date') ||
                                   item.querySelector('.date_post');
                              if (altDateEl) {
                                   dateText = altDateEl.innerText.trim();
                              }
                         }
                         return {
                              title: titleAnchor
                                   ? titleAnchor.innerText.trim()
                                   : 'N/A',
                              description: descriptionEl
                                   ? descriptionEl.innerText.trim()
                                   : 'N/A',
                              url: linkAnchor ? linkAnchor.href : 'N/A',
                              date: dateText || 'N/A',
                         };
                    });
               }, postListSelector);

               if (pageResults.length === 0 && crawlingPageNum > 1) {
                    console.log(
                         `[INFO] ${crawlingPageNum} 페이지에서 추출된 결과가 없습니다. 마지막 페이지로 간주합니다.`
                    );
                    break;
               }
               if (pageResults.length === 0 && crawlingPageNum === 1) {
                    console.log(`[INFO] 첫 페이지부터 추출된 결과가 없습니다.`);
                    break;
               }

               allResults.push(...pageResults); // Spread operator 사용
               // console.log(
               //      `[INFO] ${crawlingPageNum} 페이지에서 ${pageResults.length}개의 결과 추출 완료. 총 ${allResults.length}개.`
               // );

               // 다음 페이지로 이동
               logicalPageNumForNextButton++;
               let nextPageButtonSelector = `.pagination a.item[aria-label="${logicalPageNumForNextButton}페이지"], .pagination a.item[ng-click*="(${logicalPageNumForNextButton})"]`;
               // 현재 페이지 그룹의 마지막 페이지이고 '다음' 그룹 버튼이 있는지 확인
               // aria-label이 없는 경우, 텍스트로 페이지 번호 찾기 (XPath)
               let nextPageButtonXPath = `//div[@class="pagination"]//span[.//a[@class="item" and normalize-space(text())="${logicalPageNumForNextButton}"]]//a[@class="item" and normalize-space(text())="${logicalPageNumForNextButton}"]`;

               let nextPageButton = await page.$(nextPageButtonSelector);
               if (!nextPageButton) {
                    // CSS selector로 못찾으면 XPath로 시도 (page.evaluate로 대체)
                    const nextPageButtonHandle = await page.evaluateHandle(
                         (xpath) => {
                              const result = document.evaluate(
                                   xpath,
                                   document,
                                   null,
                                   XPathResult.FIRST_ORDERED_NODE_TYPE,
                                   null
                              );
                              return result.singleNodeValue;
                         },
                         nextPageButtonXPath
                    );
                    // puppeteer의 ElementHandle인지 확인
                    const isElement = await nextPageButtonHandle.evaluate(
                         (node) => node instanceof HTMLElement
                    );
                    if (isElement) {
                         nextPageButton = nextPageButtonHandle;
                    } else {
                         await nextPageButtonHandle.dispose();
                    }
               }

               if (nextPageButton) {
                    // console.log(
                    //      `[INFO] 다음 페이지(${logicalPageNumForNextButton}) 버튼을 찾았습니다. 클릭 실행...`
                    // );
                    try {
                         await Promise.all([
                              page.waitForNavigation({
                                   waitUntil: 'networkidle2',
                                   timeout: 60000,
                              }),
                              nextPageButton.click(),
                         ]);
                         crawlingPageNum = logicalPageNumForNextButton; // 실제 이동한 페이지로 업데이트
                         await delay(1000 + Math.random() * 1000);
                    } catch (navError) {
                         console.warn(
                              `[WARN] ${logicalPageNumForNextButton} 페이지로 이동 중 오류 또는 타임아웃:`,
                              navError.message
                         );
                         break;
                    }
               } else {
                    // 페이지 번호 버튼이 없다면 '다음' 그룹 버튼 확인
                    const nextGroupButtonSelector = '.pagination a.button_next';
                    const nextGroupButton = await page.$(
                         nextGroupButtonSelector
                    );
                    if (nextGroupButton) {
                         // console.log(
                         //      '[INFO] 다음 페이지 그룹 버튼을 찾았습니다. 클릭 실행...'
                         // );
                         try {
                              await Promise.all([
                                   page.waitForNavigation({
                                        waitUntil: 'networkidle2',
                                        timeout: 60000,
                                   }),
                                   nextGroupButton.click(),
                              ]);
                              // '다음' 그룹 버튼 클릭 후에는 logicalPageNumForNextButton이 새로운 페이지 그룹의 첫번째가 되어야 함.
                              // 실제로는 페이지가 로드된 후 다음 페이지 버튼(예: 11)을 다시 찾아야 하므로, crawlingPageNum은 다음 루프에서 결정.
                              // 다만, 다음 루프에서 logicalPageNumForNextButton이 11로 시작하도록 여기서 조정할 수 있음
                              // (또는, 그냥 다음 루프에서 11번 버튼을 찾도록 둔다)
                              // 여기서는 crawlingPageNum을 현재 logicalPageNumForNextButton(예: 10 다음이므로 11)로 가정하고 스크린샷.
                              crawlingPageNum = logicalPageNumForNextButton; // 다음 그룹의 첫 페이지로 가정
                              logicalPageNumForNextButton = crawlingPageNum; // 다음 찾을 페이지 번호도 업데이트

                              await delay(1000 + Math.random() * 1000);
                         } catch (navError) {
                              console.warn(
                                   '[WARN] 다음 페이지 그룹으로 이동 중 오류 또는 타임아웃:',
                                   navError.message
                              );
                              break;
                         }
                    } else {
                         console.log(
                              '[INFO] 다음 페이지 버튼 또는 다음 그룹 버튼을 찾을 수 없습니다. 마지막 페이지입니다.'
                         );
                         break;
                    }
               }
          }

          console.log(
               `[SUCCESS] 총 ${allResults.length}개의 검색 결과를 모든 페이지에서 추출했습니다.`
          );

          if (allResults && allResults.length > 0) {
               // 파일 저장 (companyname 하위 폴더)
               const fs = require('fs');
               const path = require('path');
               const companyDir = path.join(process.cwd(), keyword);
               if (!fs.existsSync(companyDir)) {
                    fs.mkdirSync(companyDir, { recursive: true });
               }
               const jsonPath = path.join(
                    companyDir,
                    `${keyword}_rawdata.json`
               );
               fs.writeFileSync(jsonPath, JSON.stringify(allResults, null, 2));
               console.log(`전체 결과가 ${jsonPath} 파일에 저장되었습니다.`);
          } else {
               console.log(
                    `\n--- "${keyword}" '최근 1주' 검색 결과가 없습니다. ---`
               );
          }

          return allResults;
     } catch (error) {
          console.error(
               `[ERROR] 키워드 "${keyword}" 크롤링 중 오류 발생:`,
               error.message
          );
          throw error; // 에러를 상위로 전파
     } finally {
          if (page) {
               await page.close();
          }
     }
}

async function searchBlogs(keyword, startDate, endDate) {
     let browser;
     try {
          console.log(`검색 시작: ${keyword}, 기간: ${startDate} ~ ${endDate}`);
          browser = await puppeteer.launch({ headless: true });
          const results = await crawlNaverBlogSearchAllPages(
               keyword,
               startDate,
               endDate,
               browser
          );

          // // 결과를 JSON 파일로 저장
          // const fs = require('fs');
          // const outputFile = `${keyword}_results.json`;
          // fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
          // console.log(`검색 결과가 ${outputFile}에 저장되었습니다.`);

          return results; // 검색 결과 반환
     } catch (error) {
          console.error('검색 중 오류 발생:', error);
          throw error;
     } finally {
          if (browser) {
               await browser.close();
          }
     }
}

// // --- 함수 실행 예제 ---
// (async () => {
//      try {
//           const keywordToSearch = '아이패밀리에스씨';
//           // const keywordToSearch = "puppeteer"; // 더 많은 페이지 테스트용
//           const startDate = '2025-05-23';
//           const endDate = '2025-05-24';

//           const allBlogPosts = await crawlNaverBlogSearchAllPages(
//                keywordToSearch,
//                startDate,
//                endDate
//           );

//           console.log(allBlogPosts);

//           if (allBlogPosts && allBlogPosts.length > 0) {
//                console.log(
//                     `\n--- "${keywordToSearch}" '최근 1주' 전체 검색 결과 (${allBlogPosts.length}개) ---`
//                );
//                // 결과 확인 (예: 처음 3개와 마지막 3개)
//                // console.log("첫 3개 결과:");
//                // allBlogPosts.slice(0, 3).forEach((post, index) => {
//                //     console.log(`  ${index + 1}. 제목: ${post.title}, URL: ${post.url}`);
//                // });
//                // if (allBlogPosts.length > 3) {
//                //     console.log("...");
//                //     console.log("마지막 3개 결과:");
//                //     allBlogPosts.slice(-3).forEach((post, index) => {
//                //         console.log(`  ${allBlogPosts.length - 2 + index}. 제목: ${post.title}, URL: ${post.url}`);
//                //     });
//                // }

//                // 파일 저장 (선택 사항)
//                require('fs').writeFileSync(
//                     `${keywordToSearch}_results.json`,
//                     JSON.stringify(allBlogPosts, null, 2)
//                );
//                console.log(
//                     `전체 결과가 ${keywordToSearch}_results.json 파일에 저장되었습니다.`
//                );
//           } else {
//                console.log(
//                     `\n--- "${keywordToSearch}" '최근 1주' 검색 결과가 없습니다. ---`
//                );
//           }
//      } catch (e) {
//           console.error('최종 실행 중 예외 발생:', e.message);
//      }
// })();

module.exports = {
     searchBlogs,
     crawlNaverBlogSearchAllPages,
};
