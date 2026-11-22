from urllib.parse import urlsplit, urlunsplit

from rest_framework.pagination import PageNumberPagination


class RelativePageNumberPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100

    @staticmethod
    def _relative_link(link: str | None) -> str | None:
        if link is None:
            return None
        parsed = urlsplit(link)
        return urlunsplit(("", "", parsed.path, parsed.query, ""))

    def get_next_link(self) -> str | None:
        return self._relative_link(super().get_next_link())

    def get_previous_link(self) -> str | None:
        return self._relative_link(super().get_previous_link())
