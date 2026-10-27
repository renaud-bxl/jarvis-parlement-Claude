// jarvis-speak : voix humaine française hors-ligne (modèles Piper/VITS, moteur sherpa-onnx, licence Apache-2.0).
// Usage : jarvis-speak <dossier-du-modèle> [numéro-de-voix]
// Le programme reste actif : chaque ligne lue sur l'entrée standard est « vitesse<TAB>fichier-wav<TAB>texte »,
// il écrit le WAV puis répond « OK » (ou « ERR message ») sur la sortie standard.
#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "c-api.h"

static int find_onnx(const char *dir, char *out, size_t n) {
  DIR *d = opendir(dir); if (!d) return 0; struct dirent *e; int ok = 0;
  while ((e = readdir(d))) { size_t l = strlen(e->d_name); if (l > 5 && !strcmp(e->d_name + l - 5, ".onnx")) { snprintf(out, n, "%s/%s", dir, e->d_name); ok = 1; break; } }
  closedir(d); return ok;
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: jarvis-speak dossier-modele\n"); return 2; }
  char model[2048], tokens[2048], data[2048];
  if (!find_onnx(argv[1], model, sizeof model)) { fprintf(stderr, "ERR modèle .onnx introuvable dans %s\n", argv[1]); return 3; }
  snprintf(tokens, sizeof tokens, "%s/tokens.txt", argv[1]); snprintf(data, sizeof data, "%s/espeak-ng-data", argv[1]);
  SherpaOnnxOfflineTtsConfig cfg; memset(&cfg, 0, sizeof cfg);
  cfg.model.vits.model = model; cfg.model.vits.tokens = tokens; cfg.model.vits.data_dir = data;
  cfg.model.vits.noise_scale = 0.667f; cfg.model.vits.noise_scale_w = 0.8f; cfg.model.vits.length_scale = 1.0f;
  cfg.model.num_threads = 2; cfg.model.provider = "cpu"; cfg.max_num_sentences = 1;
  const SherpaOnnxOfflineTts *tts = SherpaOnnxCreateOfflineTts(&cfg);
  if (!tts) { fprintf(stderr, "ERR chargement du modèle impossible\n"); return 4; }
  printf("READY\n"); fflush(stdout);
  int sid = argc >= 3 ? atoi(argv[2]) : 0;
  char *line = NULL; size_t cap = 0;
  while (getline(&line, &cap, stdin) > 0) {
    char *t1 = strchr(line, '\t'); if (!t1) { printf("ERR format\n"); fflush(stdout); continue; }
    char *t2 = strchr(t1 + 1, '\t'); if (!t2) { printf("ERR format\n"); fflush(stdout); continue; }
    *t1 = 0; *t2 = 0; float speed = (float)atof(line); if (speed < 0.5f || speed > 2.0f) speed = 1.0f;
    char *text = t2 + 1; size_t tl = strlen(text); while (tl && (text[tl - 1] == '\n' || text[tl - 1] == '\r')) text[--tl] = 0;
    const SherpaOnnxGeneratedAudio *a = SherpaOnnxOfflineTtsGenerate(tts, text, sid, speed);
    if (!a || a->n <= 0) { printf("ERR synthèse vide\n"); fflush(stdout); if (a) SherpaOnnxDestroyOfflineTtsGeneratedAudio(a); continue; }
    int ok = SherpaOnnxWriteWave(a->samples, a->n, a->sample_rate, t1 + 1);
    SherpaOnnxDestroyOfflineTtsGeneratedAudio(a);
    printf(ok ? "OK\n" : "ERR écriture\n"); fflush(stdout);
  }
  SherpaOnnxDestroyOfflineTts(tts); return 0;
}
