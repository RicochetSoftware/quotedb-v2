import unittest
from mysql_dump import values, normalize, sql


class ImportTests(unittest.TestCase):
    def fixture(self):
        return {
            'users': [[1, 'Name', 'USER@example.com', None, '$2y$10$' + 'a' * 53, None, 'superadmin', '2020-01-01 12:00:00', '2020-01-02 12:00:00', None]],
            'quotes': [[9, 'A quote', 'Author', 1, '2020-02-01 12:00:00', None, '2021-01-01 12:00:00']],
        }

    def test_mysql_literals(self):
        self.assertEqual(values(r'''(1,'comma, (paren); \'quote\' \\ \"double\"\nnew',NULL,'NULL','it''s'),(2,'ää',3,'','');'''), [[1, 'comma, (paren); \'quote\' \\ "double"\nnew', None, 'NULL', "it's"], [2, 'ää', 3, '', '']])

    def test_reject_executable_or_truncated_values(self):
        for text in ["(1,NOW());", "(1,'unterminated);", "(1); DROP TABLE users;", "(1,'bad\\q');"]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                values(text)

    def test_mapping_and_missing_update(self):
        result = normalize(self.fixture())
        self.assertEqual(result['users'][0]['role'], 'SUPER_ADMIN')
        self.assertEqual(result['users'][0]['email'], 'user@example.com')
        self.assertEqual(result['users'][0]['password_hash'], self.fixture()['users'][0][4])
        self.assertEqual(result['quotes'][0]['updated_at'], result['quotes'][0]['created_at'])
        self.assertEqual(result['quotes'][0]['deleted_at'], '2021-01-01T12:00:00+00:00')
        generated = sql(result)
        self.assertIn('ACCESS EXCLUSIVE', generated)
        self.assertIn('EXCEPT ALL', generated)
        self.assertTrue(generated.endswith('COMMIT;\n'))

    def test_reject_bad_relationship_and_duplicate_email(self):
        source = self.fixture()
        source['quotes'][0][3] = 999
        with self.assertRaises(ValueError):
            normalize(source)
        source = self.fixture()
        source['users'].append(source['users'][0].copy())
        source['users'][1][0] = 2
        with self.assertRaises(ValueError):
            normalize(source)

    def test_reject_unknown_role(self):
        source = self.fixture()
        source['users'][0][6] = 'owner'
        with self.assertRaises(KeyError):
            normalize(source)


if __name__ == '__main__':
    unittest.main()
