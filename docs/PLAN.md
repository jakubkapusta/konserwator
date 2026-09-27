# Konserwator

> Pracownia konserwatorska w kieszeni: zmywasz brud z arcydzieła, retuszujesz je według numerów, złocisz ramę i kładziesz werniks.

**Mieszanka:** PowerWash Simulator × Happy Color × restaurowanie obrazów
**Status:** do realizacji. Plan z 2026-09-27, wykonuje osobny agent.
**Prototyp przetwarzania obrazów:** [konserwator/prototyp/](konserwator/prototyp/). Działający kod w Pythonie do pobierania i dzielenia obrazów na pola, do przejęcia i dowolnej zmiany.

---

## Ustalenia (decyzje właściciela)

| Temat | Decyzja |
|---|---|
| Pętla obrazu | **Czyszczenie (PowerWash) → retusz według numerów (Happy Color) → złocenie ramy → werniks → galeria.** Wszystkie etapy należą do rdzenia gry, żaden nie jest dodatkiem. |
| Retusz | **Wariant B:** pomalowane pole odzyskuje prawdziwy fragment obrazu z fakturą pędzla i spękaniami, a nie płaski kolor. |
| Trudność | **Wybiera gracz** przy starcie obrazu: łatwy, średni albo trudny (liczba farb i pól). Ten sam obraz można przejść na każdym poziomie. |
| Platforma | **Główny cel to iPad z rysikiem.** Telefon to plus, laptop ma działać. |
| Obrazy | Rijksmuseum, tylko domena publiczna lub CC0. Na start kolekcja około 30 obrazów. |
| Nowe obrazy | Dodaje je agent na żądanie przez lokalne skrypty i skill w repozytorium gry. |
| Szczegóły | Mechanikę, parametry i technikę dobiera wykonawca. Plan wyznacza kierunek. |
| Język | Tekst dla gracza po polsku. Kod po angielsku, commity po polsku. |

---

## Formuła rozgrywki

Spokojna, bez porażki i bez licznika czasu. Postęp zapisuje się cały czas, więc obraz można odłożyć w dowolnym momencie, nawet w połowie etapu.

### Pętla jednego obrazu

1. **Przyjęcie zlecenia.** Obraz przychodzi do pracowni w złym stanie: pożółkły werniks, sadza, zacieki, kurz, pajęczyny, obtłuczona rama bez złoceń. Do tego krótka historia zlecenia, na przykład „znaleziony na strychu w Krakowie”. Gracz wybiera poziom trudności.
2. **Czyszczenie, czyli PowerWash.** Pociągnięciami rysika albo palca zmywasz brud warstwa po warstwie i patrzysz, jak spod szarości wychodzą kolory. Różne zabrudzenia mogą wymagać różnych narzędzi (wacik z rozpuszczalnikiem, pędzelek, skalpel do zaschniętych plam), a wskaźnik pokazuje, co jeszcze zostało. Pod brudem obraz jest wyblakły i łuszczący się, a przez warstwę farby prześwitują kontury pól z numerami.
3. **Retusz według numerów, czyli Happy Color w wariancie B.** Wybierasz farbę z palety i malujesz pola z jej numerem. Każde pole odzyskuje pełny kolor i prawdziwą fakturę oryginału. Obraz odżywa kawałek po kawałku jak odnawiany fresk.
4. **Złocenie ramy.** Kładziesz płatki złota na ramę. Płatek marszczy się, a ruch rysika go przygładza, aż zabłyśnie.
5. **Werniks.** Jeden długi ruch przez cały obraz. Pod werniksem wszystko nabiera głębi i połysku.
6. **Galeria.** Obraz zawisa w twoim muzeum. Pokazuje się karta obrazu (autor, rok, kilka prawdziwych zdań o dziele) i przyspieszone nagranie całej renowacji.

Proporcje: najwięcej czasu ma zajmować retusz, bo to on najbardziej odpręża. Czyszczenie jest mocnym, satysfakcjonującym otwarciem, a złocenie i werniks krótką celebracją na koniec. Dokładne proporcje dobiera wykonawca.

**Pomoce jak w Happy Color** (przy retuszu):
- pola wybranej farby są podświetlone,
- licznik pól, które zostały dla danej farby,
- ukończona farba znika z palety albo zostaje odhaczona,
- podpowiedź „gdzie jest ostatnie pole” z automatycznym przybliżeniem.

## Efekt wow

- **Czyszczenie:** zmywanie ma być fizycznie satysfakcjonujące, tak jak w PowerWash. Brud schodzi pod ruchem rysika z miękką krawędzią, warstwy znikają kolejno (najpierw kurz, potem pożółkły werniks), kolory wyraźnie się ocieplają. Może się przydać siła nacisku rysika.
- **Retusz:** pole nie wypełnia się od razu. Oryginał wyłania się od miejsca dotknięcia, jak nałożony pędzlem. Po przybliżeniu widać prawdziwą fakturę: pociągnięcia pędzla, spękania, ziarno płótna. Im bliżej, tym więcej detalu, więc przyda się źródło w wysokiej rozdzielczości albo kafelki.
- **Złoto:** metaliczny połysk, który zmienia się przy przechyleniu, i marszczenie płatka.
- **Werniks i finał:** światło padające z boku odsłania fakturę, połysk przesuwa się po powierzchni, chwila na podziwianie.

## Poziomy trudności

- Trzy poziomy przygotowane z góry dla każdego obrazu. Różnią się przede wszystkim liczbą farb i pól do retuszu.
- Wykonawca może też skalować czyszczenie (grubość i rodzaje brudu).
- Gracz wybiera poziom przy starcie. Może też zacząć ten sam obraz od nowa na innym poziomie.
- W galerii widać, na których poziomach obraz jest ukończony (na przykład inna rama).

## Historie

Każdy obraz ma dwie warstwy tekstu, wyraźnie od siebie oddzielone:
- **Historia zlecenia** (fikcja w grze): kto przyniósł obraz, gdzie leżał, co się z nim działo.
- **Karta obrazu** (prawdziwe fakty z opisu muzeum): autor, rok, co widać, dlaczego to ważne.

Fikcja nie może przeinaczać faktów o prawdziwym dziele. Na przykład „Mleczarka” nigdy nie leżała na strychu w Krakowie. Rozwiązanie wybiera wykonawca. Jedna z opcji: restaurujesz dawne kopie albo egzemplarze z wyobrażonych kolekcji, a karta opowiada o oryginale.

## Kolekcja startowa (około 30 obrazów z Rijksmuseum)

**Kryteria:**
- różnorodność: portrety, wnętrza, pejzaże, martwe natury, miasto, zwierzęta, kilka obrazów z XIX wieku,
- czytelna kompozycja i umiarkowana ilość detalu,
- niezbyt ciemne obrazy,
- sprawdzenie, jak obraz dzieli się na pola (podglądy z `segment.py`).

**Kandydaci**, których wykonawca sprawdza i dowolnie wymienia:
- **Vermeer:** Mleczarka, Uliczka, Kobieta czytająca list, List miłosny.
- **Rembrandt:** Żydowska narzeczona. Straż nocna tylko jako wyzwanie, bo jest bardzo szczegółowa i ciemna.
- **Frans Hals:** Wesoły pijak, portret ślubny Isaaca Massy i Beatrix van der Laen.
- **Jan Steen:** Wesoła rodzina, Święto św. Mikołaja.
- **Pieter de Hooch:** sceny z wnętrz i podwórzy.
- **Jacob van Ruisdael:** Młyn w Wijk bij Duurstede.
- **Jan Asselijn:** Zagrożony łabędź.
- **Hendrick Avercamp:** Pejzaż zimowy z łyżwiarzami.
- **Martwe natury:** Pieter Claesz, Willem Claesz Heda, Rachel Ruysch (kwiaty), Adriaen Coorte (szparagi), Jan van Huysum.
- **Pieter Saenredam:** wnętrze kościoła.
- **Gerrit Berckheyde:** Zakręt Herengracht.
- **Melchior d'Hondecoeter:** Pływające piórko (ptaki).
- **Johannes Verspronck:** Dziewczynka w błękitnej sukni.
- **Vincent van Gogh:** Autoportret z 1887 roku.
- **George Hendrik Breitner:** Dziewczyna w białym kimonie.
- **Goya:** portret Don Ramóna Satué.
- Ewentualnie kilka japońskich drzeworytów, jeśli są w zbiorach z otwartą licencją.
- Ewentualnie ikony i złocone tablice (więcej złota do położenia), jeśli znajdą się w otwartych zbiorach Rijksmuseum albo w przyszłości w innych muzeach.

## Sterowanie

- **iPad z rysikiem:** rysik zmywa, maluje (stuknięcie albo pociągnięcie przez kilka pól tej samej farby), kładzie i przygładza złoto. Palce przesuwają i przybliżają. Trzeba ignorować dłoń opartą o ekran.
- **Bez rysika** (telefon albo iPad): to samo palcem, a przesuwanie i przybliżanie dwoma palcami.
- **Laptop:** mysz robi to, co rysik, scroll przybliża.

## Obrazy: pipeline dla agenta

Obrazy przygotowuje się offline, a dane gotowych obrazów są w repozytorium. Gra je tylko wczytuje, bez przetwarzania w przeglądarce. Python jest potrzebny tylko przy dodawaniu obrazów.

- **Skrypty w repozytorium gry** (punktem wyjścia jest prototyp):
  - pobranie obrazu z Rijksmuseum ze sprawdzeniem licencji,
  - wygenerowanie trzech poziomów trudności,
  - podglądy do oceny,
  - dopisanie obrazu do katalogu.
- **Warstwy brudu i wyblakły „stan przed retuszem”** mogą być generowane proceduralnie w grze albo przygotowane w pipeline. To decyzja wykonawcy.
- **Skill w repozytorium** (`.claude/skills/…`), który prowadzi agenta przez dodanie obrazu na żądanie:
  1. znajdź obraz po tytule, autorze albo numerze,
  2. sprawdź licencję,
  3. pobierz obraz,
  4. wygeneruj poziomy,
  5. **obejrzyj podglądy** i popraw parametry, jeśli pola wyglądają źle,
  6. napisz kartę obrazu i historię zlecenia po polsku,
  7. dopisz obraz do katalogu, zbuduj grę i zrób commit.
- Przydałby się też skill albo skrypt, który po zmianie algorytmu przeliczy całą kolekcję od nowa.
- Przy każdym obrazie zapisujemy źródło i licencję, a w grze pokazujemy podpis „Rijksmuseum, domena publiczna”.

## Technicznie

- **Repozytorium:** `~/code/konserwator`, publiczne repo na GitHubie i gra na GitHub Pages.
- **Konwencje z poprzednich projektów** (`~/code/roj`, `~/code/fala`): Vite, TypeScript, `CLAUDE.md`, PWA działająca offline, workflow Pages, zasada, żeby nie czekać na deploy po push.
- **Renderer i format danych** dobiera wykonawca. Prototyp proponuje mapę regionów w PNG plus JSON z paletą i pozycjami numerów, ale to tylko propozycja. Podglądy prototypu pokazują retusz na tle papieru. W grze tłem ma być wyblakły, zniszczony obraz spod brudu.
- **Rozmiar kolekcji a tryb offline:** 30 obrazów w dobrej rozdzielczości to dużo danych. Wykonawca decyduje, co zapisywać w pamięci od razu, a co dopiero po otwarciu obrazu.

## Kamienie milowe

Nadzorca sprawdza wynik po każdym z nich.

- **M0: Szkielet.** Repozytorium, pipeline z prototypu przeniesiony do repo, 2–3 obrazy przygotowane.
- **M1: Czyszczenie i retusz na jednym obrazie**, z wyborem poziomu trudności. **STOP: właściciel testuje na iPadzie z rysikiem.** To najważniejszy punkt kontrolny: czy zmywanie daje frajdę jak PowerWash, czy retusz odpręża jak Happy Color i czy przejście między nimi działa.
- **M2: Pełna pętla.** Złocenie ramy, werniks, galeria, historie i karty, zapis postępu, skill do dodawania obrazów. Kolekcja zbudowana za pomocą tego skilla.
- **M3: Szlif.** Efekt wow na każdym etapie, przybliżenie do faktury pędzla, dźwięk (szuranie wacika, stuk pędzla, szelest złota), telefon i laptop, tryb offline.

## Ryzyka i otwarte pytania

- **Nie każdy obraz dzieli się dobrze.** Gładkie przejścia tonalne tworzą pasy jak warstwice na mapie, a ciemne obrazy zamieniają się w morze brązów. Potrzebne są parametry dla każdego obrazu osobno i przegląd podglądów, a może też poprawki algorytmu.
- **Czyszczenie może się dłużyć** na dużym obrazie. Szerokość narzędzia, liczba warstw brudu i pomoce przy ostatnich plamach mają sprawić, że będzie satysfakcjonujące, a nie żmudne.
- **iPad Safari:** zdarzenia rysika i nacisk, blokada zoomu i zaznaczania, wydajność przy setkach pól i dużej teksturze.
- **Podgląd gotowego obrazu:** czy pozwalać na niego przed skończeniem? Decyzja do sprawdzenia w M1.
- **Możliwe rozszerzenia** (nie na start): obraz dnia, inne muzea z otwartymi zbiorami (Met, National Gallery of Art), ikony i złocone tablice z dużą ilością złota.
