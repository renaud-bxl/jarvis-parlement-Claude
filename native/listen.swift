// jarvis-listen : transcrit un fichier audio avec la reconnaissance vocale de macOS (gratuite, sur l'appareil quand c'est possible).
// Usage : jarvis-listen <fichier audio> [langue, ex. fr-FR]   → écrit le texte sur la sortie standard.
import Foundation
import Speech

let args = CommandLine.arguments
// Sous-commandes : état de l'autorisation de reconnaissance vocale (sans ou avec demande à l'utilisateur).
func statusName(_ s: SFSpeechRecognizerAuthorizationStatus) -> String { switch s { case .authorized: return "authorized"; case .denied: return "denied"; case .restricted: return "restricted"; default: return "notDetermined" } }
if args.count >= 2 && (args[1] == "--status" || args[1] == "--authorize") {
  var st = SFSpeechRecognizer.authorizationStatus()
  if args[1] == "--authorize" && st == .notDetermined {
    let sem = DispatchSemaphore(value: 0); SFSpeechRecognizer.requestAuthorization { _ in sem.signal() }
    _ = sem.wait(timeout: .now() + 45); st = SFSpeechRecognizer.authorizationStatus()
  }
  print(statusName(st)); exit(0)
}
guard args.count >= 2 else { FileHandle.standardError.write(Data("usage: jarvis-listen fichier [langue]\n".utf8)); exit(2) }
let url = URL(fileURLWithPath: args[1])
let locale = Locale(identifier: args.count >= 3 ? args[2] : "fr-FR")

func fail(_ msg: String, _ code: Int32) -> Never { FileHandle.standardError.write(Data((msg + "\n").utf8)); exit(code) }

var status = SFSpeechRecognizer.authorizationStatus()
if status == .notDetermined {
  let auth = DispatchSemaphore(value: 0)
  SFSpeechRecognizer.requestAuthorization { _ in auth.signal() }
  _ = auth.wait(timeout: .now() + 45); status = SFSpeechRecognizer.authorizationStatus()
}
if status == .notDetermined { fail("AUTORISATION_ATTENTE : macOS n'a pas affiché la demande d'accès à la reconnaissance vocale.", 8) }
guard status == .authorized else { fail("AUTORISATION_REFUSEE : autorise la reconnaissance vocale pour Jarvis Parlement (Réglages Système › Confidentialité et sécurité › Reconnaissance vocale).", 3) }
guard let rec = SFSpeechRecognizer(locale: locale), rec.isAvailable else { fail("INDISPONIBLE : reconnaissance vocale indisponible pour \(locale.identifier).", 4) }
rec.queue = OperationQueue() // les réponses arrivent sur cette file (le thread principal est bloqué par les attentes ci-dessous)

// Essai 1 : sur l'appareil (privé). Essai 2 : reconnaissance Apple en ligne si le modèle hors-ligne n'est pas disponible.
func run(onDevice: Bool, wait: Double) -> (String?, String?) {
  let req = SFSpeechURLRecognitionRequest(url: url)
  req.shouldReportPartialResults = true
  req.requiresOnDeviceRecognition = onDevice
  let done = DispatchSemaphore(value: 0)
  var text: String? = nil; var err: String? = nil; var partial = ""
  let task = rec.recognitionTask(with: req) { r, e in
    if let r = r { partial = r.bestTranscription.formattedString; if r.isFinal { text = partial; done.signal(); return } }
    if let e = e { err = e.localizedDescription; done.signal() }
  }
  if done.wait(timeout: .now() + wait) == .timedOut { task.cancel(); return (partial.isEmpty ? nil : partial, "délai") }
  task.cancel()
  return (text ?? (partial.isEmpty ? nil : partial), err)
}

// Mode « hors-ligne » (écoute permanente du mot de réveil) : jamais d'envoi à Apple. Sinon : sur l'appareil d'abord, en ligne en secours.
let offlineOnly = args.count >= 4 && args[3] == "offline"
if offlineOnly && !rec.supportsOnDeviceRecognition { fail("HORS_LIGNE : la reconnaissance hors-ligne du français n'est pas installée (Réglages Système › Clavier › Dictée › Langues).", 7) }
var result: (String?, String?) = (nil, nil); var mode = "device"
if rec.supportsOnDeviceRecognition { result = run(onDevice: true, wait: offlineOnly ? 12 : 20) }
if result.0 == nil && !offlineOnly { mode = "online"; result = run(onDevice: false, wait: 60) }
FileHandle.standardError.write(Data("MODE:\(mode)\n".utf8))
if let t = result.0 { print(t) } else if offlineOnly { print("") } else { fail("ERREUR : " + (result.1 ?? "aucun texte reconnu"), 6) }
