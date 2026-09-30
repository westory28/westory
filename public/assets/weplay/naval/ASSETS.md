# 내가 충무공이라고?! 이미지 소재

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
