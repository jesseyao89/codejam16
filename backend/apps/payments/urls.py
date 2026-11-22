from django.urls import path

from apps.payments import views

app_name = "payments"

urlpatterns = [
    path("", views.PaymentListView.as_view(), name="payment-list"),
    path("prepare/", views.PaymentPrepareView.as_view(), name="payment-prepare"),
    path("<str:payment_id>/", views.PaymentDetailView.as_view(), name="payment-detail"),
    path(
        "<str:payment_id>/release/",
        views.PaymentReleaseView.as_view(),
        name="payment-release",
    ),
    path(
        "<str:payment_id>/cancel/",
        views.PaymentCancelView.as_view(),
        name="payment-cancel",
    ),
]
