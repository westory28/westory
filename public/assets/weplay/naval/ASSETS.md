# 내가 충무공이라고?! 이미지 소재

## 깃 5프레임 분리 (2026-10-18)

사용자 요청으로 SVG 변위 필터를 제거했습니다. 원본 장면·카탈로그·수자기·BGM은 유지합니다. 기존 깃 자국만 `lobby-plume-clean-plate.webp`로 가리고, 투명한 `plume-frame-1.webp`부터 `plume-frame-5.webp`까지 다섯 자세를 순서대로 표시합니다. 배경 패치는 정적이며 투구·깃발·함대의 원본 이미지를 변형하지 않습니다. 깃 뿌리는 첫 프레임으로 고정합니다.

내장 `image_gen`을 사용했습니다. 배경 제거 원본은 `exec-771d35a6-6a24-411d-a44f-1bb5a95bb85c.png`(1672×941), 다섯 행 투명 아틀라스는 `exec-6da5f931-1b02-4f41-90a8-cf51140a0a03.png`(793×1983)입니다. 행을 균등 분리해 793×397의 무손실 WebP 5개로 저장했습니다. 생성된 알파 채널을 유지하며 그림을 기하학적으로 일그러뜨리지 않습니다.

배경 편집 최종 프롬프트:

> Use case: precise-object-edit. Input image is the exact edit target. Create a clean static background plate of this 1672x941 Yi Sun-sin game scene by REMOVING ONLY the long red horsehair helmet plume and every loose red hair strand to the right of the helmet (roughly x445..1195,y25..420). Reconstruct the sunset sky/clouds/distant scenery that would be behind that plume. The black metal helmet including tip, ornament, outline, armor, admiral, Korean yellow 帥 commander flags, all ships, sea, sun, camera framing and colors MUST remain exactly where they are, unchanged. Keep the tiny helmet attachment socket but no red plume at all. No other changes, no camera shift, no new flags, no blur, no text, no UI. Output exactly the same 1672x941 landscape composition. This will be the permanently motionless layer underneath separately animated transparent hair sprites.

깃 아틀라스 최종 프롬프트:

> Use case: background-extraction and stylized-concept. Input image is a reference for ONLY the red horsehair plume, its warm painterly 3D game style and sunset lighting. Create ONE animation sprite sheet containing EXACTLY FIVE sequential images of ONLY this red helmet plume on genuine transparent background. Canvas 1024x2560 pixels, ONE column of FIVE equal 1024x512 cells, no gaps, no labels, no dividers. Every cell contains the SAME long crimson horsehair plume at IDENTICAL scale, perspective, lighting, strand density and root location. The root is pinned at cell-local (70,105); it initially rises slightly and flows gracefully to the right and downward, tapering into fine separated strands by x940,y410. Keep all art inside each cell with transparent margins. Do not draw any helmet, metal, person, sky, cloud, boat, flag or shadow background. Five frames are small, coherent wind variations of the same plume: frame1 neutral flowing arc; frame2 tips gently lift 12 pixels; frame3 tips lift 24 pixels with delayed small middle wave; frame4 tips ease down 12 pixels; frame5 returns near neutral, continuing a smooth looping ripple. The first 100 pixels after the root must be IDENTICAL across all five cells; no root jitter, no camera motion, no radical outline or volume changes, no twisting, no stretching. Preserve deep red shadows and copper rim-lit fine hair. This is hand-authored pose animation, not image distortion. Transparent alpha between every individual trailing strand. There must be five and only five complete plume poses, vertically stacked in exact equal cells. No checkerboard painted into pixels.

정상 재생은 프레임당 180ms, 동작 감소는 240ms입니다. 한 번에 하나의 불투명 자세만 표시하며 투명도 중첩·변위·이동·확대는 없습니다. 멈춤·숨김·화면 밖에서는 현재 자세를 보존하고 재개합니다. 자산을 전부 디코딩하기 전이나 실패 시 기존 완성 장면을 표시합니다. 아래 변위 필터 관련 이전 설명은 이 계약으로 대체합니다.

## 수자기와 깃 움직임 정정 (2026-10-18)

아군 판옥선의 일본식 원형 꽃 문양을 제거하고 누런 천·검은 `帥`자·붉은 가장자리의 수자기로 교체했습니다. 작은 아군 깃발은 문양 없는 황색·붉은 천으로 정리했습니다. 멀리 있는 일본 함대는 유지했습니다. `lobby-yi-sunsin.webp`(1672×941)와 같은 장면의 `catalog-yi-sunsin.webp`(960×720)를 함께 교체했고 `?v=sujagi-2`로 이전 브라우저 캐시와 구분합니다.

근거: [국립국어원 수기/수자기 정의](https://kli.korean.go.kr/term/trgtWord/indexTrgtWord.do?trgtWordNo=2280429)의 누런 바탕·검은 帥자 설명과 [강화전쟁박물관 수자기 설명](https://www.ganghwa.go.kr/open_content/museum_war/bbs/bbsMsgDetail.do?bcd=relic&msg_seq=464&pgno=6)의 지휘관 군기 성격을 참고했습니다. 후자는 1871년 어재연 장군의 유물이며 이순신이 사용한 실물로 혼동하지 않습니다. 박물관 사진은 수정·배포하지 않았습니다.

내장 `image_gen`의 부분 편집으로 기존 장면의 깃발만 수정했습니다. 원본 PNG는 `exec-04dd8f04-2424-49e4-81a5-bff208b65d17.png`이며, 결과를 확인한 뒤 WebP 압축과 기존 썸네일 크롭만 적용했습니다. 깃 형태·좌표·인물·함대 구도는 유지했습니다.

최종 편집 프롬프트:

> Use case: precise-object-edit. Edit the provided 1672x941 game lobby artwork. Change ONLY the ALLIED FLAGS in the LEFT FOREGROUND on the Korean panokseon where Admiral Yi Sun-sin stands. The existing dark banners with circular flower/Japanese clan crests are WRONG. Completely remove every Japanese flower/circle crest on ALL banners and small flags in the leftmost 240 pixels, including those behind his left shoulder. Replace the two large foreground flags with historical Korean commander Sujagi banners: weathered warm YELLOW/OCHRE cloth, narrow muted RED cloth edging/streamers, and ONE large legible BLACK brush-written Chinese character exactly '帥' (commander). The main flag at x120-235,y130-310 must show the complete and correct character 帥 without a circle or floral crest. The taller left flag around x40-105,y60-220 should also carry 帥; simplify the small distant allied flags to plain red/yellow cloth without emblems. This is a Joseon naval commander scene, NOT Japanese allied soldiers. Preserve all distant enemy ships at x600-1672, with their existing tiny flags. CRITICAL preserve Admiral's helmet, armor, shoulders, silhouette, exact framing, face-hidden rear view, red plume shape and all plume strand positions at (460,85)-(1180,425), ocean, sunset, fleet count and painterly warm 3D game style exactly. Do not move the camera or redraw the plume. Maintain original image dimensions and composition. No added UI, labels, logos, watermark or new objects. No Japanese mon, cherry blossom crests, rising suns or Japanese flags anywhere in the foreground Korean camp. Only correct the left foreground flags. The character on the flags must be 帥, not 师, 水, 壽 or any other glyph.

사용자 요청에 따라 OS 동작 감소가 깃을 숨기거나 멈추지 않습니다. 정상 변형 scale은 80±8, 동작 감소는 50±5이며 같은 3.8초 주기로 깃 영역만 움직입니다. 명시적 멈춤/켜기, 비활성 탭·화면 밖 일시정지는 유지합니다. 이 계약은 아래 최초 버전의 동작 감소 정지 설명을 대체합니다.

## 판옥선 위 이순신 대기 화면 (2026-10-18)

- `lobby-yi-sunsin.webp`: 내장 `image_gen`으로 생성한 1672×941 대기 장면.
- `catalog-yi-sunsin.webp`: 같은 이미지의 왼쪽 중심 4:3 크롭, 960×720 썸네일.
- 윷놀이의 따뜻한 게임 일러스트를 화풍 기준으로 삼고, 투구와 어깨를 가까이 잡은 이순신의 뒷모습과 빽빽한 일본 함대를 표현했습니다. 생성 후 크롭·축소·WebP 압축만 적용했습니다.
- 투구는 《노량》 공개 스틸의 길게 좁아지는 흑철·은색 형태를 참고해 금빛 왕관형 장식을 줄였습니다. 영화 의상은 고증과 창작을 함께 사용하므로 특정 실물·실제 착용 갑주의 정확한 복원으로 표시하지 않습니다.
- 붉은 모자 깃 주변에만 약 3.8초 주기의 가시적인 국소 펄럭임을 적용합니다. 실제 HTML 메뉴·버튼을 유지하고 동작 감소 설정, 비활성 탭, 화면 밖에서는 모션이 멈춥니다.

참고 자료(게임에는 원본 사진을 배포하지 않음):

- [한국영상자료원 《명량》 의상 자료와 의상감독 인터뷰](https://www.koreafilm.or.kr/museum/theater/module/TI_00000013): 유물·논문을 바탕으로 영화적 창작을 더했다는 제작자 설명.
- [《노량》 공개 스틸 보도](https://www.tenasia.co.kr/article/2023110938004): 투구의 실루엣·철색 표면 참고.
- [권유진 의상감독 인터뷰](https://www.khan.co.kr/article/202104060600015): 《명량》·《한산》·《노량》의 의상 재현과 창작 구분.

생성 방식: 기본 내장 이미지 생성 도구, 불투명 배경. 아래 두 프롬프트로 구도·화풍을 수정하고 투구를 보완했습니다. 이전 사실적 원안은 최종 자산에 사용하지 않습니다.

구도·화풍 프롬프트:

> Use case: style-transfer and historical-scene. Create a revised landscape 16:9 game-lobby artwork. INPUT 1 (Yut game characters) is the STRICT ART STYLE reference: warm inviting high-quality stylized 3D animated adventure-game illustration, softly rounded shapes, slightly simplified readable materials, rich warm colours, not gritty photorealism. INPUT 2 (Yi Sun-sin sea scene) is the COMPOSITION/SCENE reference to revise dramatically. Keep the view from BEHIND Admiral Yi Sun-sin standing on a Joseon panokseon wooden deck, watching Japanese warships at sea. Change to an EXTREME CLOSE over-the-shoulder BACK VIEW: his large helmet and broad shoulders fill the left 55 percent and lower half. Camera is much closer than input 2: crop the body at the upper back/shoulders, no waist, no legs, no hands. Helmet crown around x=31% y=14%, large black bronze Korean helmet from x=21% to x=41%; dark red and bronze shoulder armor should extend across the entire bottom-left. A very visible long scarlet red horsehair helmet plume streams freely toward the RIGHT across the upper-middle sky, slender separated strands and broad flowing shape from x=33% y=15% to x=60% y=35%, like a windswept crimson brush. The plume must be easy to animate later, floating in clear sky, not overlapping the helmet or ships at its free end. Keep subtle wood railing at bottom to establish panokseon deck. The ocean is CROWDED, TEEMING with dozens and dozens of 16th-century Japanese ships: many layers of small and medium wooden hulls, pale tan/grey square sails and restrained dark flags, packed densely across the middle-right and distant horizon, from foreground mid-distance to tiny silhouettes. Do not leave only a handful of large ships. Blue-teal sea, low Korean coastal islands, golden warm clouds. Match the friendly polished storybook/animated-game rendering quality and warm materials of INPUT 1, but Admiral remains HUMAN and heroic, not an animal, not comedic. Rightmost 30% somewhat quieter/darker for later HTML controls while still showing abundant ships through atmosphere. No drawn UI, text, title, logos, watermark, borders, speech bubbles, modern ships, firearms firing, battle violence or fantasy horns. Entirely original stylized artwork. Landscape 16:9.

최종 투구 보완 프롬프트:

> Use case: precise-object-edit. INPUT 1 is the EDIT TARGET, the close back-view game lobby scene. INPUT 2 is a costume reference from the film Noryang, specifically its helmet and restrained dark silver armour, NOT a subject/face/pose reference. INPUT 3 is the Yut game ART STYLE reference. Make one precise correction to INPUT 1: replace Admiral Yi Sun-sin's fantasy gold-domed helmet and lavish gold armour with a costume interpretation closely informed by Noryang and The Admiral: Roaring Currents (Myeongnyang). The HELMET must have the tall tapering pointed conical/spheroconical silhouette shown in INPUT 2, dark iron with aged silver engraved bands/raised restrained scroll details and a narrow straight top finial; NO rounded gold onion/crown stack, NO broad golden crown rim, NO fantasy Samurai horns. Show the rear of this helmet, tapering smoothly from broad lower shell to narrow pointed apex. Replace the huge flared gold-riveted bell neck shape with a protective dark iron lamellar neck drape and restrained dark fabric lining. Shoulders and back should be practical dark charcoal/silver lamellar armour with muted small metal accents and deep red cloth beneath, not giant golden dragon heads. Keep the stylized, warm polished 3D adventure-game illustration style matching INPUT 3, slightly softer and more simplified materials, not photorealistic. CRITICAL INVARIANTS: keep the exact camera position, EXTREME CLOSE BACK VIEW, character size and placement, horizon, crowded Japanese fleet, golden sky, blue sea, railing, overall 1672x941 landscape framing and ALL plume geometry from INPUT 1. The SCARLET HORSEHAIR PLUME must remain flowing RIGHT from approximately (460,85) to (1160,390), including its loose strands and open sky backdrop, because that precise region is animated by the application. Keep the crown tip within the top-left helmet region without clipping. Do not show face or copy an actor's likeness. Do not add text, labels, logos, UI or watermarks. The result is a film-informed original game illustration, not a claim of exact historical reconstruction. Change only the helmet/armour materials and silhouette as described; preserve the atmosphere, fleet count, scene layout and red plume position.

사용자가 제공한 해전 화면과 투명 스프라이트 시트를 기준으로 제작했습니다.
이미지는 내장 `image_gen`으로 생성했으며, 원본 그림을 바꾸지 않고 WebP로 변환·축소해 웹 전송량을 줄였습니다. 투명 이미지의 알파 채널을 유지했습니다.

| 파일 | 용도 | 제작 |
| --- | --- | --- |
| sea-battle.webp | 섬·바다·하늘 배경 | 내장 이미지 생성 |
| allied-ship.webp | 오른쪽을 향하는 거북선 | 내장 이미지 생성 |
| enemy-ship.webp | 왼쪽을 향하는 적선 | 내장 이미지 생성 |
| explosion.webp | 화염·연기·파편 폭발 | 내장 이미지 생성 |
| reference-sprites.webp | 제목·지휘관·화포·포탄·물보라 | 사용자 제공 시트, WebP 변환 |
| lobby-turtle-ship.webp | 시작 화면의 거북선 | 사료·2022년 해군 재현 자료를 참고한 새 일러스트, 내장 이미지 생성, 1200×900 WebP |
| yi-sunsin-cutin.webp | 필살기 성공 때의 이순신 눈빛 컷인 | 내장 이미지 생성, 1440×480 WebP, 약207KB |
| impact-lines.webp | 필살기 성공 때의 만화 집중선 | 내장 이미지 생성, 투명1200×800 WebP, 약441KB |

게임은 이미지를 별도 레이어로 움직이며, 체력·시간·점수·입력창은 실제 HTML 요소입니다. 화면 전체를 한 장의 이미지로 대체하지 않습니다.

## 배경음악 (2026-10-18)

`tide-of-victory.wav`는 이 게임을 위해 새로 작곡·합성한 45초 전투 루프입니다. 기존의 차분한 6/8박자 곡을 128BPM·4/4박자·24마디의 힘찬 전투 편곡으로 교체했습니다. 조선시대 악사의 합주를 주제로, 북·장구를 떠올리게 하는 낮고 높은 타격음, 징 느낌의 금속 잔향, 태평소 느낌의 관악 선율과 빠른 현 반복구를 겹쳤습니다. 네 마디 단위로 진격·응답·절제·돌격·절정·복귀를 구성하고, 마지막 북 연타와 잔향은 첫 마디로 이어집니다. D단조 오음음계를 중심으로 새 선율과 짧은 꾸밈음을 작곡했습니다.

기존 사극의 음악이나 외부 음원을 샘플링하지 않았으며 외부 생성 API도 사용하지 않았습니다. 생성 원본은 `scripts/generate-weplay-score.py`이고, 고정 시드 `20261018`로 동일한 PCM 음원을 재현합니다. 실제 전통 악기 녹음이나 역사적 연주법의 정확한 복원이 아닌 수학적 합성 음색입니다. 형식은 기존과 같은 모노 22,050Hz/16비트 WAV이며 약 1.98MB입니다. 피크를 0.75로 제한해 약 2.5dB의 여유를 두고, 게임 재생 볼륨 0.28과 기존 효과음·음소거 설정을 유지합니다. 첫 재생은 사용자의 게임 시작 또는 음악 버튼 조작으로 이루어지고, 탭이 숨겨지거나 화면을 떠나면 정지합니다. 윷놀이 음악과 공용 인트로는 변경하지 않았습니다.

검증: `scripts/verify-weplay-music-browser.mjs`가 실제 WAV 디코딩·클리핑·루프 경계·무음 구간·구간 강약과 실제 브라우저의 제스처 재생, 반복, 음소거 저장, 탭 숨김/복귀, 화면 이탈, 자동재생 차단 뒤 재시도를 검사합니다.

## 전투 효과음 (2026-10-07)

`weplaySoundDesign.ts`에서 고정 시드로 직접 합성합니다. 외부 음원이나 녹음을 사용하지 않았습니다. 단어 완료는 짧은 목재·금속 장전음, 화포는 낮은 폭발음과 공기 잔향, 필살기는 포격 연출에 맞춘 연속 발사음입니다. 첫 입력 제스처에 Web Audio 버퍼를 준비해 재사용하고, 기존 음소거 버튼으로 배경음악과 함께 제어합니다. 탭이 숨겨지거나 전투 화면을 떠나면 정지합니다.

## 필살기 강조 이미지 (2026-09-30)

사용자가 제시한 만화 집중선·눈빛 컷인 형식을 참고해 새 래스터 이미지를 생성했습니다. 특정 만화 인물이나 패널을 복제하지 않았으며, 이순신 장군의 실제 얼굴을 재현했다고 주장하지 않는 게임 일러스트입니다. 이미지 생성 뒤 크기 조정·WebP 변환만 수행했습니다. 눈빛 컷인은1.4초만 나타나고, 집중선의 가운데는 투명합니다. 두 파일은 정적 자산으로 재사용하며 애니메이션 중 서버 호출은 없습니다.

생성 프롬프트:

- **yi-sunsin-cutin.webp** — Original premium historical Korean naval game special-attack cut-in, ultra-wide4:1. Extreme close-up of Admiral Yi Sun-sin's focused eyes, brow, cheeks and nose; stern Korean man about fifty, human dark eyes, realistic age lines. Historically grounded Joseon iron helmet edge, no samurai helmet, fantasy horns or supernatural pupils. High-contrast black-and-white manhwa brush ink and hatching, restrained gold glint, dark outer edges, both eyes large and centered. No words, logos, interface, watermark, existing manga character or panel. Detailed original raster illustration, not vector.
- **impact-lines.webp** — Landscape3:2 transparent raster comic impact overlay. Irregular hand-inked tapered radial speed lines point inward from all edges to a fully transparent oval center occupying60% width and65% height. White and warm off-white streaks with charcoal outlines and stippled corners; spaces between strokes also transparent. No opaque backing, characters, text, symbols or interface. Original dynamic manga/manhwa brush effect, not uniform geometric vector wedges.

## 생성 프롬프트

공통 기준: 사용자가 제공한 사실적인 16세기 해전 게임 아트의 목재·돛·조명·재질을 유지합니다. 벡터·만화 도형, 워터마크, 불필요한 텍스트는 넣지 않습니다.

1. **sea-battle.webp** — Wide16:9 cinematic realistic16th-century Korean coastal sea, rolling blue teal waves, forested island mountains, dramatic sunlit clouds and distant battle smoke. Entire lower65% open textured sea, horizon upper third, islands at distant left/right. Remove ALL text, logo, HUD, hearts, buttons, input boxes, people, deck, banners and ALL SHIPS. Clean panoramic battlefield background only. Match reference warm sunlight and natural materials.
2. **allied-ship.webp** — ONE isolated high-detail Korean turtle ship matching the upper-right reference sprite: carved dragon prow, dark spiked roof, rich warm wooden hull, broad amber sail, oars and small commander flag. Entire ship visible, three-quarter side view, prow RIGHT. Genuine transparent background and generous padding. No other objects, text, UI, ocean, backdrop shadow or frame. Clean edges without colored matte.
3. **enemy-ship.webp** — ONE isolated high-detail enemy warship matching the lower-left reference sprite: tall dark grey sails with white circular mon emblems, ornate multi-tier wooden Japanese16th-century superstructure, red banners, weathered hull and rigging. Broad three-quarter side view, BOW LEFT. Genuine transparent exterior. No sea, reflection, ground, backdrop shadow, text, HUD or other ships. Clean edges without colored matte.
4. **explosion.webp** — One transparent realistic cannon-impact effect sprite. Bright white-yellow core, orange flame and sparks, charcoal and grey billowing smoke, small wood splinters, rounded asymmetrical burst dissipating into transparent edges. Full effect with padding. No ship, terrain, text, UI or backdrop. Dramatic realistic VFX, designed to animate at100–250px over blue ocean.

## 시작 화면 거북선 교체 (2026-09-29)

기존 전투용 `allied-ship.webp`와 별개로 시작 화면에 `lobby-turtle-ship.webp`를 사용합니다. 임진왜란 당시 모습의 재현 방향을 참고한 게임 일러스트이며, 특정 실물의 정확한 도면·복제 이미지는 아닙니다. 생성 후 목재 덮개, 짧은 쇠못, 낮고 곧게 연결된 용머리, 포문과 노가 표현되는지 확인했습니다. 세부 치수·포문 수·돛대 구조까지 확정된 고증으로 표시하지 않습니다.

참고 근거:
- [국가유산청 자료: 거북선 등 조선시대 선박 관련 자료](https://www.cha.go.kr/cmm/fms/BoardFileDown.do?atchFileId=FILE_000000000018213&bbsId=BBSMSTR_1075&dwldHistYn=N&fileSn=0): 당포파왜병장의 용머리 포구·등의 쇠송곳 기록과 판자 덮개 기록. 검색에 공개된 본문을 확인했으며 원문 다운로드는 리디렉션으로 열리지 않았습니다.
- [MBC, 해군사관학교 거북선 재현 취재·박물관장 인터뷰 (2022-12-07)](https://imnews.imbc.com/replay/2022/nw1400/article/6434131_35722.html): 임진왜란기 기록을 바탕으로 한 2022년 재현선의 낮은 일자형 용머리와 목재 덮개를 확인했습니다.

생성 방식: 내장 `image_gen`, 신규 이미지 생성, 불투명 배경. 원본은 Codex generated_images에 보존하고 웹용 크기·WebP 형식만 변환했습니다. 사진을 복사하거나 SVG로 대체하지 않았습니다.

프롬프트:
> Create a premium realistic painted 4:3 landscape historical naval game lobby illustration, no text or interface. Depict one historically informed Korean geobukseon turtle ship of the Imjin War, based on documented features from Yi Sun-sin's 1592 Dangpo battle report and the Republic of Korea Naval Academy's 2022 reconstruction. Three-quarter view, broad side visible, bow facing RIGHT, the entire ship and oar tips comfortably inside the frame with margin. A broad, squat wooden panokseon-like hull with dark weathered pine planks and several cannon gunports along each side, working wooden oars close to water, enclosed rounded low wooden-plank turtle-back covering with scattered short iron spikes. Roof must clearly be WOOD PLANKS, absolutely NOT metal armor, not hexagonal steel tiles. The dragon head is small, low and forward-projecting in a nearly horizontal straight line directly connected to the bow at the gun-deck height, with a cannon mouth opening. NO tall curved dragon neck. NO dragon creature body. NO pagoda or palace towers, no huge sail covering the roof. A modest mast with sail furled/lowered and believable restrained Korean rigging, no Japanese emblems, no writing. A historically grounded reconstruction-inspired illustration rather than a claim of an exact archaeological replica. Ship fills about 80 percent of image width in lower two thirds, clearly showing wooden roof and low prow. Dynamic but restrained foamy dark teal Korean coastal sea, hazy forested southern coastal islands behind, golden side-light breaking through grey-blue sky, dramatic warm bronze wood detail, cinematic naval game realism matching Korean 16th-century warship art. Keep ship lighter and visually separated from cool sea. No people close-up, no enemies, no UI, no labels, no logos, no watermark, no invented ironclad machinery, no SVG/vector look. Original artwork, not a reproduction of any photograph.
