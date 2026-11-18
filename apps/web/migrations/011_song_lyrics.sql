-- Letra inteira da música, colada de uma vez. O músico aponta cada trecho no compasso
-- (isso vira "voz N: …" na cifra); aqui fica o texto completo, inclusive o que ainda não foi encaixado.
ALTER TABLE songs ADD COLUMN lyrics text NOT NULL DEFAULT '';
