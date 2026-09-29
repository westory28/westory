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

게임은 이미지를 별도 레이어로 움직이며, 체력·시간·점수·입력창은 실제 HTML 요소입니다. 화면 전체를 한 장의 이미지로 대체하지 않습니다.

## 생성 프롬프트

공통 기준: 사용자가 제공한 사실적인 16세기 해전 게임 아트의 목재·돛·조명·재질을 유지합니다. 벡터·만화 도형, 워터마크, 불필요한 텍스트는 넣지 않습니다.

1. **sea-battle.webp** — Wide16:9 cinematic realistic16th-century Korean coastal sea, rolling blue teal waves, forested island mountains, dramatic sunlit clouds and distant battle smoke. Entire lower65% open textured sea, horizon upper third, islands at distant left/right. Remove ALL text, logo, HUD, hearts, buttons, input boxes, people, deck, banners and ALL SHIPS. Clean panoramic battlefield background only. Match reference warm sunlight and natural materials.
2. **allied-ship.webp** — ONE isolated high-detail Korean turtle ship matching the upper-right reference sprite: carved dragon prow, dark spiked roof, rich warm wooden hull, broad amber sail, oars and small commander flag. Entire ship visible, three-quarter side view, prow RIGHT. Genuine transparent background and generous padding. No other objects, text, UI, ocean, backdrop shadow or frame. Clean edges without colored matte.
3. **enemy-ship.webp** — ONE isolated high-detail enemy warship matching the lower-left reference sprite: tall dark grey sails with white circular mon emblems, ornate multi-tier wooden Japanese16th-century superstructure, red banners, weathered hull and rigging. Broad three-quarter side view, BOW LEFT. Genuine transparent exterior. No sea, reflection, ground, backdrop shadow, text, HUD or other ships. Clean edges without colored matte.
4. **explosion.webp** — One transparent realistic cannon-impact effect sprite. Bright white-yellow core, orange flame and sparks, charcoal and grey billowing smoke, small wood splinters, rounded asymmetrical burst dissipating into transparent edges. Full effect with padding. No ship, terrain, text, UI or backdrop. Dramatic realistic VFX, designed to animate at100–250px over blue ocean.
