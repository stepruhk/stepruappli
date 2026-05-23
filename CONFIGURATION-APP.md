# Configuration De L'App

Ce fichier sert de pense-bete simple pour Render, Supabase et les mots de passe.

## 1) Services utilises

- Hebergement de l'app: Render
- Base de donnees / stockage: Supabase
- Depot du code: GitHub

## 2) URL importantes

- App en ligne: `https://eduboost-ai.onrender.com`
- Repo GitHub: `https://github.com/stepruhk/stepruappli`
- Contact: `https://credibilityinstitute.com/contact`
- Blog: `https://stepru.wordpress.com`
- Spotify / balado: flux RSS configure dans `PODCAST_RSS_URL`

## 3) Variables Render importantes

Ces variables doivent exister dans Render -> `Environment`.

### Connexion generale

- `OPENAI_API_KEY`
- `APP_PASSWORD`
- `PROF_PASSWORD`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Mots de passe par cours (mode etudiant)

- `COURSE_PASSWORD_1`
- `COURSE_PASSWORD_2`
- `COURSE_PASSWORD_3`
- `COURSE_PASSWORD_8`
- `COURSE_PASSWORD_4`
- `COURSE_PASSWORD_5`
- `COURSE_PASSWORD_6`
- `COURSE_PASSWORD_7`

Correspondance actuelle:

- `COURSE_PASSWORD_1` -> `Communication avec les medias et les influenceurs`
- `COURSE_PASSWORD_2` -> `Introduction a la comm strat`
- `COURSE_PASSWORD_3` -> `Theories de la communication`
- `COURSE_PASSWORD_8` -> `Relations de presse`
- `COURSE_PASSWORD_4` -> `Gerer la reputation`
- `COURSE_PASSWORD_5` -> `Ingenierie de la credibilite (R)`
- `COURSE_PASSWORD_6` -> `Recherche, mesure, evaluation et analyse de donnees`
- `COURSE_PASSWORD_7` -> `Influence`

### Balado

- `PODCAST_RSS_URL`

### Statistiques d'acces

- `APP_LAUNCH_DATE`
- `ACCESS_METRICS_BASE_TOTAL`
- `ACCESS_METRICS_BASE_STUDENT`
- `ACCESS_METRICS_BASE_PROFESSOR`

## 4) Mot de passe global

- Mode etudiant general: `APP_PASSWORD`
- Mode professeur general: `PROF_PASSWORD`

Le mot de passe global etudiant donne acces a l'app.
Les mots de passe `COURSE_PASSWORD_*` donnent acces a chaque cours, en mode etudiant seulement.

## 5) Si quelque chose ne fonctionne plus

### Si l'app charge tres lentement

- Verifier dans Render que le plan n'est pas retombe sur `Free`
- Verifier que le service est bien en `Starter` si tu veux eviter le sommeil

### Si Contenu / Annonces / Notes affichent `fetch failed`

- Ouvrir Render -> `Logs`
- Chercher `ENOTFOUND` ou `supabase.co`
- Verifier dans Render -> `Environment`:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

### Si un changement de code n'apparait pas

- Verifier que le `git push origin main` a bien reussi
- Verifier dans GitHub que le commit est visible
- Ensuite dans Render:
  - `Manual Deploy`
  - `Deploy latest commit`

### Si l'auto-deploy ne part plus

- Verifier dans Render -> `Settings` -> `Build & Deploy`:
  - repo GitHub correct
  - branche `main`
  - `Auto-Deploy` active

## 6) Commandes utiles

```bash
cd /Users/stephaneprudhomme/Desktop/codex
npm run build
git status
git push origin main
```

## 7) Regle simple

Pour des modifications de contenu dans l'app:
- pas besoin d'ouvrir Terminal

Pour des modifications de code:
- Terminal
- GitHub
- Render
