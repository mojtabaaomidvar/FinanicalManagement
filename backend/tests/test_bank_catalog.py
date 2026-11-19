from app.services.bank_catalog import BANKS, card_matches_bank


def test_official_catalog_keeps_neobanks_and_uses_longest_card_prefix():
    assert len(BANKS) == 37
    assert card_matches_bank('6219861800000001', 'blubank')
    assert card_matches_bank('6219861800000001', 'saman')
    assert not card_matches_bank('6219861800000001', 'melli')
    assert card_matches_bank('6037990000000001', 'بانک ملی')


def test_shared_prefix_accepts_both_official_institutions_and_preserves_unknown_legacy_values():
    assert card_matches_bank('5022290000000001', 'wepod')
    assert card_matches_bank('5022290000000001', 'pasargad')
    assert not card_matches_bank('5022290000000001', 'saderat')
    assert card_matches_bank('9999990000000001', 'بانک قدیمی')
