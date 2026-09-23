# Mise en relation commerciale entre entreprises (Phase 9)

## 1. Principe

Une **demande de mise en relation** (`partnership_requests`, migration
0023) formalise une intention humaine explicite : « cette entreprise
m'intéresse, je veux lui parler ». C'est un mécanisme **dédié**, distinct
de deux mécanismes déjà existants avec lesquels il ne faut pas le
confondre :

- `opportunity_responses` (Phase 5) : réponse à une **opportunité
  publiée** par une entreprise (une intention commerciale ponctuelle et
  publique).
- `company_offers`/`company_needs` (Phase 3) : ce qu'une entreprise
  déclare proposer ou rechercher, utilisé par le moteur de correspondance
  (Phase 6) pour calculer un score — jamais une communication directe.

Une demande de mise en relation peut naître d'une suggestion de
correspondance, d'une opportunité, ou simplement de la consultation de
l'annuaire public — mais dans tous les cas, **toujours entre deux
entreprises**, jamais d'un utilisateur isolé vers une entreprise : le
demandeur agit toujours au nom d'une entreprise à laquelle il appartient
(propriétaire, administrateur ou membre — jamais un simple observateur).
Une entreprise ne peut jamais s'adresser une demande à elle-même.

## 2. D'où peut venir une demande (`source_type`)

| Valeur         | Signifie                                                                                     | Référence conservée                     |
| -------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `DIRECTORY`    | Initiée depuis la fiche publique d'une entreprise, sans lien avec un score ou une opportunité | aucune                                    |
| `MATCH`        | Initiée depuis une suggestion du moteur de correspondance                                     | `source_match_id` (la ligne `matches`)   |
| `OPPORTUNITY`  | Initiée depuis une opportunité publiée par l'entreprise cible                                 | `source_opportunity_id`                  |
| `OTHER`        | Tout autre cas                                                                                 | aucune                                    |

**Important : la demande ne recalcule ni ne copie jamais un score.** Pour
une demande `MATCH`, seule une référence vers le match déjà calculé est
conservée — le sujet et le message restent des champs libres saisis par
l'utilisateur, jamais pré-remplis à partir du score ou de l'explication du
moteur de correspondance. La base vérifie elle-même, au moment de la
création, que le match ou l'opportunité référencé concerne réellement les
deux entreprises de la demande — impossible de faire pointer une demande
vers un match ou une opportunité appartenant à d'autres entreprises.

## 3. Entreprise cible non revendiquée

Une entreprise sur la plateforme peut n'avoir encore aucun membre (cas
d'une entreprise importée, voir docs/CLAIMING.md). Une demande peut tout
de même lui être adressée : son statut est alors `pending_unclaimed`
plutôt que `pending`. **Aucune notification n'est envoyée dans ce cas** —
il n'y a personne à notifier, et la plateforme ne sollicite jamais
activement une adresse récupérée par import. Dès que l'entreprise est
revendiquée (docs/CLAIMING.md), les demandes `pending_unclaimed` qui
l'attendaient deviennent visibles et notifiées au nouveau membre.

## 4. Statuts

`pending` (en attente d'une réponse de la cible) → `accepted` / `declined`
(réponse de la cible), ou `withdrawn` (retrait par le demandeur avant
réponse) ; `pending_unclaimed` (voir §3) ; `expired` (réservé pour un
usage futur, pas encore produit automatiquement cette phase). Une seule
demande active (`pending` ou `pending_unclaimed`) à la fois entre deux
mêmes entreprises — une nouvelle demande redevient possible après un
refus, un retrait ou une expiration.

## 5. Qui peut agir

| Rôle dans l'entreprise | Envoyer une demande | Répondre (accepter/refuser) | Retirer sa propre demande |
| ----------------------- | :------------------: | :---------------------------: | :--------------------------: |
| Propriétaire / Administrateur / Membre | ✅ | ✅ | ✅ |
| Observateur (`viewer`) | ❌ | ❌ | ❌ |

Un membre (`member`, pas seulement `owner`/`admin`) peut donc envoyer,
accepter ou refuser une demande **sans être automatiquement notifié**
lorsqu'une nouvelle demande arrive pour son entreprise : les notifications
sont, dans cette première version, envoyées uniquement aux propriétaires
et administrateurs actifs de l'entreprise concernée. Un membre reste
capable de consulter et de répondre depuis « Mes mises en relation » ; il
doit simplement penser à s'y rendre lui-même. Ce choix pourra être revu
plus tard si le besoin s'en fait sentir.

## 6. Confidentialité

Une acceptation confirme uniquement **que la demande a été acceptée** —
jamais un courriel, un téléphone ou une adresse personnels. **Mise à jour
Phase 10C (LOT 10C-3)** : `professional_email`/`phone` ne sont plus
affichés sur la fiche publique (déplacés vers `company_contacts`, jamais
public — voir `docs/SECURITY.md`) ; le site web reste la seule coordonnée
publique. Le déverrouillage de coordonnées privées à l'acceptation d'une
demande reste une décision volontairement laissée à une itération future.

## 7. Notifications

Une notification interne (`notifications`, réutilisée depuis la Phase 5)
est créée pour : nouvelle demande reçue (sauf `pending_unclaimed`, §3),
demande acceptée, demande refusée. Les messages de notification sont
génériques (« Une entreprise souhaite entrer en relation avec vous »),
sans nom d'entreprise, pour éviter une requête supplémentaire de
résolution de nom à chaque notification — un choix de simplicité assumé
pour cette version. Aucun courriel n'est envoyé ; consultez « Mes
notifications » dans votre compte.

## 8. Ce qui n'a pas été construit cette phase

- Abonnements, paliers FREE/PREMIUM/BUSINESS, CRM complet — explicitement
  hors du périmètre de cette phase.
- Traduction automatique du sujet ou du message — restent tels que saisis
  par l'utilisateur.
- Notifications en temps réel (WebSocket) — la page « Mes notifications »
  doit être consultée activement, comme `/admin/revendications`
  aujourd'hui (voir docs/CLAIMING.md §8).
- Déverrouillage de coordonnées de contact privées à l'acceptation (§6).
- Demande de mise en relation autour d'une entreprise candidate suggérée
  pour une opportunité (au-delà de la réponse directe déjà permise par
  `opportunity_responses`) — non mélangée à ce mécanisme cette phase.
