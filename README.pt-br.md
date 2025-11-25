# Voxel Craft MVP

Um mundo voxel leve no navegador, feito com **three.js** e JavaScript puro. Foca em terreno, renderização por chunks, física básica e interação com blocos — otimizado para FPS alto em PCs medianos.

## Recursos
- Terreno voxel procedural com variação de altura (grama/terra).
- Geração de malha por chunks (16x16) com remoção de faces internas.
- Carregamento dinâmico de chunks ao redor do jogador.
- Controles em primeira pessoa com gravidade, pulo, subida de degrau e colisões.
- Colocar/remover blocos com o mouse (LMB coloca, RMB remove).
- HUD simples com FPS e posição do jogador.

## Stack
- three.js (via CDN, ES module)
- HTML + CSS + JavaScript (sem build)

## Como rodar localmente
Precisa apenas de um servidor estático para liberar o carregamento de módulos no navegador:
```bash
# Opção 1: Python 3
python -m http.server 8000
# Opção 2: serve (Node)
npx serve .
```
Depois abra `http://localhost:8000` no navegador.

## Controles
- `WASD`: mover
- `Espaço`: pular
- `Shift`: correr
- Mouse: olhar (pointer lock)
- **Clique esquerdo**: coloca bloco de grama
- **Clique direito**: remove bloco

## Estrutura
- `index.html` — página e HUD
- `style.css` — estilos e overlay
- `main.js` — cena, terreno, chunks, física, controles e blocos

## Notas de performance
- Faces internas são removidas; cada chunk gera uma única malha.
- Distância de visão limitada por raio de chunks para reduzir geometria/draw calls.
- Materiais Lambert com cores de vértice; sem texturas pesadas ou sombras caras.
- Pixel ratio do renderer é limitado para equilibrar nitidez e desempenho.
